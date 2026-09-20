import XCTest

@testable import Roost

final class AppNotificationsTests: XCTestCase {
    private let agentId = "13199f14-64dc-4ff7-a93b-c3caa4c1a411"
    private let registrationId = "13199f14-64dc-4ff7-a93b-c3caa4c1a412"
    private let otherId = "13199f14-64dc-4ff7-a93b-c3caa4c1a413"

    func testPushPayloadRequiresAgentAndRegistrationIdentities() throws {
        XCTAssertNil(RoostPushPayload(userInfo: ["agentId": agentId]))
        XCTAssertNil(
            RoostPushPayload(userInfo: ["agentId": "../other", "registrationId": registrationId]))
        XCTAssertNil(
            RoostPushPayload(userInfo: ["agentId": agentId, "registrationId": "arbitrary"]))
        let payload = try XCTUnwrap(
            RoostPushPayload(userInfo: [
                "agentId": agentId, "registrationId": registrationId, "conversationId": otherId,
            ]))
        XCTAssertEqual(payload.agentId, agentId)
        XCTAssertEqual(payload.conversationId, otherId)
        XCTAssertNil(
            RoostPushPayload(userInfo: [
                "agentId": agentId, "registrationId": registrationId,
                "conversationId": "https://evil.example",
            ])?
            .conversationId)
    }

    func testNotificationRoutingRejectsOtherServerDeviceRevocationAndRotatedRegistration() throws {
        let connection = Connection(
            server: URL(string: "https://roost.example")!, token: "current-secret")
        let saved = SavedPushRegistration(
            connectionFingerprint: SavedPushRegistration.fingerprint(connection),
            registrationId: registrationId)
        let payload = try XCTUnwrap(
            RoostPushPayload(userInfo: ["agentId": agentId, "registrationId": registrationId]))
        XCTAssertTrue(saved.matches(payload, connection: connection, status: status()))
        XCTAssertFalse(
            saved.matches(
                payload,
                connection: Connection(
                    server: URL(string: "https://other.example")!, token: connection.token),
                status: status()))
        XCTAssertFalse(
            saved.matches(
                payload, connection: Connection(server: connection.server, token: "another-device"),
                status: status()))
        XCTAssertFalse(
            saved.matches(payload, connection: connection, status: status(registered: false)))
        XCTAssertFalse(
            saved.matches(payload, connection: connection, status: status(configured: false)))
        XCTAssertFalse(saved.matches(payload, connection: connection, status: status(id: otherId)))
        let stale = try XCTUnwrap(
            RoostPushPayload(userInfo: ["agentId": agentId, "registrationId": otherId]))
        XCTAssertFalse(saved.matches(stale, connection: connection, status: status()))
    }

    func testSavedRegistrationDoesNotPersistAPNsOrBearerSecrets() throws {
        let connection = Connection(
            server: URL(string: "https://roost.example")!,
            token: "never-store-this-secret-in-preferences")
        let saved = SavedPushRegistration(
            connectionFingerprint: SavedPushRegistration.fingerprint(connection),
            registrationId: registrationId)
        let data = try JSONEncoder().encode(saved)
        let text = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertFalse(text.contains(connection.token))
        XCTAssertFalse(text.contains("deviceToken"))
        XCTAssertEqual(saved.connectionFingerprint.count, 64)
        XCTAssertEqual(saved, try JSONDecoder().decode(SavedPushRegistration.self, from: data))
    }

    @MainActor func testDisableWaitsForInFlightRegistrationBeforeDeleting() async throws {
        let writes = PushRegistrationWrites()
        let started = AsyncStream<Void>.makeStream()
        var events: [String] = []
        var release: CheckedContinuation<Data, Error>?
        let registration = writes.enqueue {
            events.append("POST")
            return try await withCheckedThrowingContinuation { continuation in
                release = continuation
                started.continuation.yield(())
            }
        }
        var observer = started.stream.makeAsyncIterator()
        _ = await observer.next()
        let deletion = writes.enqueue {
            events.append("DELETE")
            return Data()
        }
        // The DELETE is enqueued synchronously, but cannot overtake this POST.
        XCTAssertEqual(events, ["POST"])
        release?.resume(returning: Data())
        _ = try await registration.value
        _ = try await deletion.value
        XCTAssertEqual(events, ["POST", "DELETE"])
        started.continuation.finish()
    }

    @MainActor func testFailedRegistrationStillAllowsQueuedDeletion() async throws {
        let writes = PushRegistrationWrites()
        enum NetworkFailure: Error { case lostResponse }
        var events: [String] = []
        let registration = writes.enqueue {
            events.append("POST")
            throw NetworkFailure.lostResponse
        }
        let deletion = writes.enqueue {
            events.append("DELETE")
            return Data()
        }
        _ = await registration.result
        _ = try await deletion.value
        XCTAssertEqual(events, ["POST", "DELETE"])
    }

    private func status(registered: Bool = true, configured: Bool = true, id: String? = nil)
        -> NativePushStatus
    {
        NativePushStatus(
            configured: configured, registered: registered, environment: "sandbox",
            bundleId: "dev.roost.iphone", registrationId: id ?? registrationId)
    }
}
