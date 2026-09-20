import XCTest

@testable import Roost

final class SessionIsolationTests: XCTestCase {
    @MainActor func testCancelledReconnectLeavesTheCurrentSessionIntact() async throws {
        let app = AppModel()
        let connection = try Connection.make(
            server: "https://roost.example",
            token: "roost_mobile_" + String(repeating: "a", count: 43))
        app.connection = connection
        let session = app.sessionID
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            try await app.connect(
                server: "https://another-roost.example",
                token: "roost_mobile_" + String(repeating: "b", count: 43))
        }
        do {
            try await task.value
            XCTFail("Cancelled reconnect must not replace the current connection")
        } catch is CancellationError {
        }
        XCTAssertEqual(app.connection, connection)
        XCTAssertEqual(app.sessionID, session)
    }

    @MainActor func testChangingDeviceCredentialsResetsConnectionBoundScreensAndModels() throws {
        let app = AppModel()
        let first = try Connection.make(
            server: "https://roost.example",
            token: "roost_mobile_" + String(repeating: "a", count: 43))
        app.connection = first
        let agent = Agent(
            id: UUID().uuidString, name: "Moss", instructions: "Help", character: "moss",
            model: "fixture", kind: nil)
        app.agents = [agent]
        let original = try XCTUnwrap(app.conversation(agent: agent))
        let session = app.sessionID
        app.loading = true
        let replacement = try Connection.make(
            server: "https://roost.example",
            token: "roost_mobile_" + String(repeating: "b", count: 43))
        app.connection = replacement
        XCTAssertNotEqual(app.sessionID, session)
        XCTAssertTrue(app.agents.isEmpty)
        XCTAssertFalse(app.loading)
        let fresh = try XCTUnwrap(app.conversation(agent: agent))
        XCTAssertFalse(fresh === original)
        XCTAssertFalse(original.isSessionActive)
        XCTAssertTrue(fresh.isSessionActive)
        XCTAssertEqual(fresh.api.connection, replacement)
        let renewed = app.sessionID
        app.connection = replacement
        XCTAssertEqual(app.sessionID, renewed)
        app.connection = nil
        XCTAssertNotEqual(app.sessionID, renewed)
        XCTAssertFalse(fresh.isSessionActive)
        XCTAssertNil(app.conversation(agent: agent))
    }
}
