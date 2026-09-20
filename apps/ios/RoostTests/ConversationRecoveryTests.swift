import XCTest

@testable import Roost

private final class RecoveryURLProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = (URLRequest) async throws -> (Int, Data)
    private static let lock = NSLock()
    private static var handlers: [String: Handler] = [:]
    private var loadTask: Task<Void, Never>?

    static func install(host: String, handler: @escaping Handler) {
        lock.lock()
        defer { lock.unlock() }
        handlers[host] = handler
    }

    static func remove(host: String) {
        lock.lock()
        defer { lock.unlock() }
        handlers.removeValue(forKey: host)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock()
        let handler = Self.handlers[request.url!.host!]
        Self.lock.unlock()
        loadTask = Task {
            do {
                guard let handler else { throw URLError(.resourceUnavailable) }
                let (status, data) = try await handler(request)
                guard !Task.isCancelled else { return }
                let response = HTTPURLResponse(
                    url: request.url!, statusCode: status, httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data)
                client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() { loadTask?.cancel() }
}

private actor DeliveryGate {
    private var released = false
    private var continuation: CheckedContinuation<Void, Never>?
    func wait() async {
        guard !released else { return }
        await withCheckedContinuation { continuation = $0 }
    }
    func release() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}

@MainActor final class ConversationRecoveryTests: XCTestCase {
    private let token = "roost_mobile_" + String(repeating: "a", count: 43)
    private let emptySnapshot = Data(
        #"{"entries":[],"revision":1,"before":null,"threads":[],"busy":false,"runId":null,"status":null}"#
            .utf8)

    private func transport(_ handler: @escaping RecoveryURLProtocol.Handler) throws -> RoostAPI {
        let host = UUID().uuidString.lowercased() + ".example.com"
        RecoveryURLProtocol.install(host: host, handler: handler)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: configuration)
        addTeardownBlock {
            session.invalidateAndCancel()
            RecoveryURLProtocol.remove(host: host)
        }
        return RoostAPI(
            connection: try Connection.make(server: "https://" + host, token: token),
            session: session)
    }

    private func model(api: RoostAPI, conversation: String? = nil) -> ConversationModel {
        let agent = Agent(
            id: UUID().uuidString, name: "Moss", instructions: "Help", character: "moss",
            model: "fixture", kind: nil)
        let conversation = conversation ?? agent.id
        addTeardownBlock {
            try Drafts.save(
                SavedDraft(text: "", attachments: [], pending: nil), server: api.connection.server,
                agent: agent.id, conversation: conversation)
        }
        return ConversationModel(agent: agent, conversationId: conversation, api: api)
    }

    nonisolated private func sent(_ request: URLRequest) throws -> SendRequest {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let size = stream.read(&bytes, maxLength: bytes.count)
                if size <= 0 { break }
                data.append(contentsOf: bytes.prefix(size))
            }
        }
        return try JSONDecoder().decode(SendRequest.self, from: data)
    }

    func testExplicitRejectionUnlocksComposerAndPreservesDraftAfterRestart() async throws {
        let api = try transport { _ in
            (400, Data(#"{"error":"Edit this message.","code":"message_rejected"}"#.utf8))
        }
        let model = model(api: api)
        model.draft = "Needs a correction"
        model.attachments = [
            Attachment(id: "file", name: "Plan.txt", mimeType: "text/plain", size: 5)
        ]
        await model.send()
        XCTAssertNil(model.pending)
        XCTAssertFalse(model.deliveryUnconfirmed)
        XCTAssertTrue(model.canSend)
        XCTAssertEqual(model.error, "Edit this message.")
        let restored = ConversationModel(
            agent: model.agent, conversationId: model.conversationId, api: api)
        XCTAssertEqual(restored.draft, "Needs a correction")
        XCTAssertEqual(restored.attachments, model.attachments)
        XCTAssertNil(restored.pending)
        restored.draft = "Corrected"
        XCTAssertEqual(try restored.prepareSend()?.text, "Corrected")
    }

    func testAmbiguousFailureThenExpiredTokenKeepsExactPayloadUntilSuccessfulRetry() async throws {
        for firstStatus in [400, 503, -1] {
            var attempt = 0
            var requests: [SendRequest] = []
            let snapshot = emptySnapshot
            let api = try transport { request in
                if request.url!.path.hasSuffix("/messages") {
                    requests.append(try self.sent(request))
                    attempt += 1
                    if attempt == 1 {
                        if firstStatus == -1 { throw URLError(.networkConnectionLost) }
                        return (firstStatus, Data(#"{"error":"Response interrupted"}"#.utf8))
                    }
                    if attempt == 2 { return (401, Data()) }
                    return (202, Data(#"{"id":"accepted"}"#.utf8))
                }
                return request.url!.path.hasSuffix("/approvals")
                    ? (200, Data("[]".utf8)) : (200, snapshot)
            }
            let model = model(api: api)
            model.draft = "Send exactly once"
            model.attachments = [
                Attachment(id: "file", name: "Plan.txt", mimeType: "text/plain", size: 5)
            ]
            await model.send()
            let pending = try XCTUnwrap(model.pending)
            XCTAssertTrue(model.deliveryUnconfirmed)
            let restored = ConversationModel(
                agent: model.agent, conversationId: model.conversationId, api: api)
            restored.draft = String(repeating: "Changed payload", count: 4000)
            XCTAssertTrue(restored.canSend, "Frozen retry must not depend on a changed local draft")
            await restored.send()
            XCTAssertEqual(
                restored.pending, pending, "An expired token cannot prove a previous attempt failed"
            )
            XCTAssertTrue(restored.deliveryUnconfirmed)
            await restored.send()
            XCTAssertEqual(requests, [pending, pending, pending])
            XCTAssertNil(restored.pending)
            XCTAssertFalse(restored.deliveryUnconfirmed)
            XCTAssertEqual(restored.draft, String(repeating: "Changed payload", count: 4000))
            XCTAssertTrue(restored.attachments.isEmpty)
        }
    }

    func testAttachmentOnlyBusyFollowupShowsSendAndUsesEmptyText() async throws {
        var request: SendRequest?
        let snapshot = emptySnapshot
        let api = try transport { incoming in
            if incoming.url!.path.hasSuffix("/messages") {
                request = try self.sent(incoming)
                return (202, Data("{}".utf8))
            }
            return incoming.url!.path.hasSuffix("/approvals")
                ? (200, Data("[]".utf8)) : (200, snapshot)
        }
        let model = model(api: api)
        model.busy = true
        XCTAssertTrue(model.showsStop)
        model.attachments = [
            Attachment(id: "file", name: "Plan.txt", mimeType: "text/plain", size: 5)
        ]
        XCTAssertFalse(model.showsStop)
        XCTAssertTrue(model.canSend)
        await model.send()
        XCTAssertEqual(request?.text, "")
        XCTAssertEqual(request?.attachmentIds, ["file"])
    }

    func testMessageLimitCountsUTF16LikeServerAndTrimsBeforeValidation() throws {
        let model = model(api: try transport { _ in (200, Data()) })
        model.draft = "  " + String(repeating: "🌱", count: 16000) + "  "
        XCTAssertTrue(model.canSend)
        XCTAssertEqual(model.messageLength, 32000)
        model.draft = String(repeating: "🌱", count: 16001)
        XCTAssertEqual(model.draft.count, 16001)
        XCTAssertFalse(model.canSend)
        XCTAssertThrowsError(try model.prepareSend())
        XCTAssertNil(model.pending)
    }

    func testReplacingTokenPreservesDraftAttachmentsAndPendingIdentity() async throws {
        let agent = Agent(
            id: UUID().uuidString, name: "Moss", instructions: "Help", character: "moss",
            model: "fixture", kind: nil)
        let newToken = "roost_mobile_" + String(repeating: "b", count: 43)
        let api = try transport { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + newToken)
            return request.url!.path.hasSuffix("/session")
                ? (200, Data(#"{"apiVersion":1}"#.utf8))
                : (200, try JSONEncoder().encode([agent]))
        }
        let previousConnection = try SecureConnection.load()
        defer {
            if let previousConnection {
                try? SecureConnection.save(previousConnection)
            } else {
                try? SecureConnection.clear()
            }
            try? Drafts.save(
                SavedDraft(text: "", attachments: [], pending: nil), server: api.connection.server,
                agent: agent.id, conversation: agent.id)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let app = AppModel(session: session)
        app.connection = api.connection
        let originalGeneration = app.sessionID
        let original = try XCTUnwrap(app.conversation(agent: agent))
        original.draft = "Keep this through a token change"
        original.attachments = [
            Attachment(id: "file", name: "Plan.txt", mimeType: "text/plain", size: 5)
        ]
        let pending = try XCTUnwrap(original.prepareSend())
        // An edit not yet observed by SwiftUI also needs to be saved before
        // cached conversation models are replaced.
        original.draft = "Saved local draft"
        try await app.connect(server: api.connection.server.absoluteString, token: newToken)
        let restored = try XCTUnwrap(app.conversation(agent: agent))
        XCTAssertFalse(restored === original)
        XCTAssertNotEqual(app.sessionID, originalGeneration)
        XCTAssertEqual(restored.api.connection.token, newToken)
        XCTAssertEqual(restored.draft, "Saved local draft")
        XCTAssertEqual(restored.attachments, original.attachments)
        XCTAssertEqual(restored.pending, pending)
        XCTAssertEqual(try restored.prepareSend(), pending)
    }

    func testLateSendCannotOverwriteReplacementDraftOrResurrectDisconnectedDraft() async throws {
        let agent = Agent(
            id: UUID().uuidString, name: "Moss", instructions: "Help", character: "moss",
            model: "fixture", kind: nil)
        let oldToken = token
        let newToken = "roost_mobile_" + String(repeating: "b", count: 43)
        let gate = DeliveryGate()
        defer { Task { await gate.release() } }
        let started = XCTestExpectation(description: "Old-token send is awaiting its response")
        let snapshot = emptySnapshot
        var requests: [SendRequest] = []
        let api = try transport { request in
            if request.url!.path.hasSuffix("/messages") {
                requests.append(try self.sent(request))
                if request.value(forHTTPHeaderField: "Authorization") == "Bearer " + oldToken {
                    started.fulfill()
                    await gate.wait()
                }
                return (202, Data("{}".utf8))
            }
            if request.url!.path.hasSuffix("/session") {
                return (200, Data(#"{"apiVersion":1}"#.utf8))
            }
            if request.url!.path.hasSuffix("/agents") {
                return (200, try JSONEncoder().encode([agent]))
            }
            return request.url!.path.hasSuffix("/approvals")
                ? (200, Data("[]".utf8)) : (200, snapshot)
        }
        let previousConnection = try SecureConnection.load()
        defer {
            if let previousConnection {
                try? SecureConnection.save(previousConnection)
            } else {
                try? SecureConnection.clear()
            }
            try? Drafts.save(
                SavedDraft(text: "", attachments: [], pending: nil), server: api.connection.server,
                agent: agent.id, conversation: agent.id)
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecoveryURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let app = AppModel(session: session)
        app.connection = api.connection
        let old = try XCTUnwrap(app.conversation(agent: agent))
        old.draft = "Already being delivered"
        let oldSend = Task { await old.send() }
        let startedResult = await XCTWaiter.fulfillment(of: [started], timeout: 5)
        XCTAssertEqual(startedResult, .completed)
        let pending = try XCTUnwrap(old.pending)

        try await app.connect(server: api.connection.server.absoluteString, token: newToken)
        let current = try XCTUnwrap(app.conversation(agent: agent))
        XCTAssertEqual(current.pending, pending)
        await current.send()
        XCTAssertEqual(requests, [pending, pending], "Token replacement retries the same delivery")
        current.draft = "My next fresh draft"
        try current.saveDraft()

        await gate.release()
        await oldSend.value
        old.draft = "A stale view update"
        old.persistDraft()
        XCTAssertFalse(old.canSend)
        XCTAssertThrowsError(try old.prepareSend())
        XCTAssertEqual(
            try Drafts.load(server: api.connection.server, agent: agent.id, conversation: agent.id)?
                .text,
            "My next fresh draft")

        try await app.disconnect(revoke: false)
        current.draft = "A disconnected view update"
        current.persistDraft()
        XCTAssertFalse(current.canSend)
        XCTAssertNil(
            try Drafts.load(server: api.connection.server, agent: agent.id, conversation: agent.id))
    }

    func testOldRefreshCannotReplaceNewConnectionAgentsOrError() async throws {
        let previousConnection = try SecureConnection.load()
        defer {
            if let previousConnection {
                try? SecureConnection.save(previousConnection)
            } else {
                try? SecureConnection.clear()
            }
        }
        let oldToken = token
        let newToken = "roost_mobile_" + String(repeating: "b", count: 43)
        let currentAgent = Agent(
            id: UUID().uuidString, name: "Current", instructions: "Help", character: "moss",
            model: "fixture", kind: nil)
        for status in [200, 401] {
            let gate = DeliveryGate()
            defer { Task { await gate.release() } }
            let started = XCTestExpectation(description: "Old agent list is awaiting its response")
            let api = try transport { request in
                if request.value(forHTTPHeaderField: "Authorization") == "Bearer " + oldToken {
                    started.fulfill()
                    await gate.wait()
                    return (status, Data("[]".utf8))
                }
                return request.url!.path.hasSuffix("/session")
                    ? (200, Data(#"{"apiVersion":1}"#.utf8))
                    : (200, try JSONEncoder().encode([currentAgent]))
            }
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [RecoveryURLProtocol.self]
            let session = URLSession(configuration: configuration)
            defer { session.invalidateAndCancel() }
            let app = AppModel(session: session)
            app.connection = api.connection
            let refresh = Task { await app.refresh() }
            let startedResult = await XCTWaiter.fulfillment(of: [started], timeout: 5)
            XCTAssertEqual(startedResult, .completed)
            try await app.connect(server: api.connection.server.absoluteString, token: newToken)
            await gate.release()
            await refresh.value
            XCTAssertEqual(app.agents, [currentAgent])
            XCTAssertNil(app.error)
            XCTAssertFalse(app.loading)
        }
    }

    func testApprovalsStayInTheirRunAndStaleApprovalCannotBeAnswered() async throws {
        var currentRun: String? = "reply-run"
        var failApprovals = false
        let api = try transport { request in
            if request.url!.path.hasSuffix("/approvals") {
                if failApprovals { throw URLError(.networkConnectionLost) }
                return (
                    200,
                    Data(
                        #"[{"id":"main","runId":"main-run","title":"Main only","details":"Main"},{"id":"reply","runId":"reply-run","title":"Reply only","details":"Reply"}]"#
                            .utf8)
                )
            }
            return (
                200,
                try JSONSerialization.data(withJSONObject: [
                    "entries": [], "revision": 1, "threads": [], "busy": currentRun != nil,
                    "runId": currentRun as Any? ?? NSNull(),
                ])
            )
        }
        let model = model(api: api, conversation: "reply")
        await model.refresh()
        XCTAssertEqual(model.approvals.map(\.id), ["reply"])
        let stale = try XCTUnwrap(model.approvals.first)
        currentRun = nil
        failApprovals = true
        await model.refresh()
        XCTAssertTrue(
            model.approvals.isEmpty,
            "An approval fetch failure must not retain a finished run's controls")
        do {
            try await model.answer(stale, decision: "approve", answers: [:])
            XCTFail("Stale approval should be rejected before posting")
        } catch { XCTAssertTrue(error.localizedDescription.contains("no longer waiting")) }
    }
}
