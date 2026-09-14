import Foundation
import Observation

@MainActor @Observable final class ConversationModel {
    let agent: Agent
    let conversationId: String
    let api: RoostAPI
    var entries: [Entry] = []
    var threads: [ReplyThread] = []
    var approvals: [Approval] = []
    var draft = ""
    var attachments: [Attachment] = []
    var pending: SendRequest?
    var error: String?
    var busy = false
    var sending = false
    private(set) var deliveryUnconfirmed = false
    var loading = true
    var uploading = false
    var status: String?
    var runId: String?
    var before: Int?
    private var revision: Int?
    private var refreshing = false
    private var loadingOlder = false
    private var acceptedOutgoing: [Message] = []
    private(set) var arrivingMessageIDs: Set<String> = []

    var outgoingMessage: Message? {
        guard let pending else { return nil }
        return Message(
            id: pending.messageId, role: "user", text: pending.text,
            title: nil, status: nil, details: nil,
            files: attachments.filter { pending.attachmentIds.contains($0.id) }, createdAt: nil
        )
    }

    var displayedEntries: [Entry] {
        let local = acceptedOutgoing + (outgoingMessage.map { [$0] } ?? [])
        let knownIDs = Set(entries.map(\.id))
        return entries
            + local.filter { !knownIDs.contains($0.id) }.enumerated()
            .map { index, message in
                Entry(position: (entries.last?.position ?? 0) + index + 1, message: message)
            }
    }

    init(agent: Agent, conversationId: String, api: RoostAPI) {
        self.agent = agent
        self.conversationId = conversationId
        self.api = api
        do {
            if let saved = try Drafts.load(
                server: api.connection.server, agent: agent.id, conversation: conversationId)
            {
                draft = saved.text
                attachments = saved.attachments
                pending = saved.pending
                deliveryUnconfirmed = saved.pending != nil
            }
        } catch { self.error = "Could not restore this draft. " + error.localizedDescription }
    }

    func saveDraft() throws {
        try Drafts.save(
            SavedDraft(text: draft, attachments: attachments, pending: pending),
            server: api.connection.server, agent: agent.id, conversation: conversationId)
    }

    func persistDraft() {
        do { try saveDraft() } catch {
            self.error = "Could not save your draft. " + error.localizedDescription
        }
    }
    var path: String { "agents/\(agent.id)/" }

    func merge(_ incoming: [Entry]) {
        if revision != nil {
            let knownIDs = Set(entries.map(\.id))
            let latestPosition = entries.last?.position ?? 0
            arrivingMessageIDs.formUnion(
                incoming.filter {
                    !knownIDs.contains($0.id) && $0.position > latestPosition
                        && $0.message.role != "user"
                }
                .map(\.id))
        }
        var map = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        for entry in incoming { map[entry.id] = entry }
        entries = map.values.sorted { $0.position < $1.position }
        let receivedIDs = Set(incoming.map(\.id))
        acceptedOutgoing.removeAll { receivedIDs.contains($0.id) }
    }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer {
            refreshing = false
            loading = false
        }
        do {
            var query = [URLQueryItem(name: "conversationId", value: conversationId)]
            if let revision { query.append(URLQueryItem(name: "since", value: String(revision))) }
            let snapshot: Snapshot = try await api.get(path + "conversation", query: query)
            try Task.checkCancellation()
            merge(snapshot.entries)
            if revision == nil { before = snapshot.before }
            revision = snapshot.revision
            threads = snapshot.threads
            busy = snapshot.busy
            runId = snapshot.runId
            status = snapshot.status
            let approvals: [Approval] = try await api.get(path + "approvals")
            try Task.checkCancellation()
            self.approvals = approvals
            error = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {} catch { self.error = error.localizedDescription }
    }

    func loadOlder() async {
        guard let before, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page: Snapshot = try await api.get(
                path + "conversation",
                query: [
                    URLQueryItem(name: "conversationId", value: conversationId),
                    URLQueryItem(name: "before", value: String(before)),
                ])
            merge(page.entries)
            self.before = page.before
        } catch { self.error = error.localizedDescription }
    }

    func prepareSend() throws -> SendRequest? {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard pending != nil || !text.isEmpty || !attachments.isEmpty else { return nil }
        // Keep the exact payload and UUID after ambiguous network failure. A
        // retry cannot enqueue a duplicate turn or change an accepted request.
        let input =
            pending
            ?? SendRequest(
                messageId: UUID().uuidString, conversationId: conversationId, text: text,
                attachmentIds: attachments.map(\.id))
        let previous = pending
        pending = input
        do {
            try saveDraft()
            deliveryUnconfirmed = false
            return input
        } catch {
            pending = previous
            throw error
        }
    }

    func send() async {
        guard !sending else { return }
        sending = true
        defer { sending = false }
        do {
            guard let input = try prepareSend() else { return }
            _ = try await api.post(path + "messages", input)
            if let outgoing = outgoingMessage, !entries.contains(where: { $0.id == outgoing.id }) {
                acceptedOutgoing.append(outgoing)
            }
            pending = nil
            draft = ""
            attachments = []
            error = nil
            try saveDraft()
            await refresh()
        } catch {
            deliveryUnconfirmed = pending != nil
            self.error = error.localizedDescription
        }
    }

    func stop() async {
        guard let runId else { return }
        do {
            _ = try await api.post(path + "stop", ["id": runId])
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    func reply(to message: Message) async -> String? {
        guard message.role == "assistant", conversationId == agent.id else { return nil }
        do {
            let data = try await api.post(path + "threads", ["parentMessageId": message.id])
            let response = try JSONDecoder().decode(IDResponse.self, from: data)
            await refresh()
            return response.id
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func answer(_ approval: Approval, decision: String, answers: [String: String]) async throws {

        struct Response: Encodable {
            let decision: String
            let answers: [String: String]?
        }

        struct Input: Encodable {
            let id: String
            let response: Response
        }
        _ = try await api.post(
            path + "approvals",
            Input(
                id: approval.id,
                response: Response(
                    decision: decision, answers: decision == "answer" ? answers : nil)))
        await refresh()
    }
}
@MainActor @Observable final class AppModel {
    var connection: Connection?
    var agents: [Agent] = []
    var error: String?
    var loading = false
    private var conversations: [String: ConversationModel] = [:]

    init() {
        Drafts.clearPreviews()
        #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-ui-testing-reset") {
                try? SecureConnection.clear()
                try? Drafts.clear()
                UserDefaults.standard.removeObject(forKey: "responseStyle")
                UserDefaults.standard.removeObject(forKey: "themePreset")
                UserDefaults.standard.removeObject(forKey: "appearance")
            }
        #endif
        do { connection = try SecureConnection.load() } catch {
            self.error = error.localizedDescription
        }
    }
    var api: RoostAPI? { connection.map { RoostAPI(connection: $0) } }

    func conversation(agent: Agent, id: String? = nil) -> ConversationModel? {
        guard let api else { return nil }
        let id = id ?? agent.id
        let key = agent.id + ":" + id
        if let existing = conversations[key] { return existing }
        let model = ConversationModel(agent: agent, conversationId: id, api: api)
        conversations[key] = model
        return model
    }

    func connect(server: String, token: String) async throws {
        let connection = try Connection.make(server: server, token: token)
        let api = RoostAPI(connection: connection)
        let session: SessionResponse = try await api.get("session")
        guard session.apiVersion == 1 else {
            throw APIError(message: "Update the app to connect to this server.")
        }
        let agents: [Agent] = try await api.get("agents")
        try SecureConnection.save(connection)
        conversations = [:]
        self.agents = agents
        self.connection = connection
        error = nil
    }

    func refresh() async {
        guard let api, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            agents = try await api.get("agents")
            error = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {} catch { self.error = error.localizedDescription }
    }

    func disconnect(revoke: Bool) async throws {
        if revoke, let api { _ = try await api.request("session", method: "DELETE") }
        try Drafts.clear()
        Drafts.clearPreviews()
        try SecureConnection.clear()
        connection = nil
        agents = []
        conversations = [:]
        error = nil
    }
}
