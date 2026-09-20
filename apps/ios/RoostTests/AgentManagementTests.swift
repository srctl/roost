import XCTest

@testable import Roost

final class AgentManagementTests: XCTestCase {
    func testUngroupedMovesAndSectionOrderingEncodeRequiredNulls() throws {
        let move = AgentNavigationChange(action: "move", agentId: "agent")
        let object =
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(move)) as! [String: Any]
        XCTAssertTrue(object["sectionId"] is NSNull)
        XCTAssertTrue(object["beforeAgentId"] is NSNull)
        let reorder = AgentNavigationChange(action: "reorder-section", direction: "up")
        let section =
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(reorder)) as! [String: Any]
        XCTAssertTrue(section["id"] is NSNull)
        XCTAssertEqual(section["direction"] as? String, "up")
    }

    func testCodingSettingsCanExplicitlyClearDefaultExecutionProfile() throws {
        let settings = AgentCodingSettings(
            agentId: "agent", repository: "", projectInstructions: "", defaultProfileId: nil,
            sources: [], revision: 4)
        let object =
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(settings)) as! [String: Any]
        XCTAssertTrue(object["defaultProfileId"] is NSNull)
        XCTAssertEqual(object["revision"] as? Int, 4)
    }

    func testSavedNavigationOrderPreservesNewAgentsAndToleratesRemovedAgents() {
        let agents = [agent("a"), agent("b"), agent("c")]
        let navigation = AgentNavigation(
            sections: [], memberships: [:], agentOrder: ["removed", "b", "a"], ungroupedPosition: 0)
        XCTAssertEqual(navigation.ordered(agents).map(\.id), ["b", "a", "c"])
        XCTAssertEqual(AgentNavigation.empty.ordered(agents).map(\.id), ["a", "b", "c"])
    }

    func testQueuedReflectionWithNullErrorDecodes() throws {
        let data = Data(
            #"{"soul":{"content":"Soul","revision":"r1","updatedAt":"2026-09-20"},"memories":[],"changes":[],"reflection":{"intervalMinutes":360,"nextRunAt":null,"latest":{"id":"queued","status":"queued","error":null}}}"#
                .utf8)
        let identity = try JSONDecoder().decode(AgentIdentity.self, from: data)
        let latest = try XCTUnwrap(identity.reflection.latest)
        XCTAssertEqual(latest.status, "queued")
        XCTAssertTrue(latest.error == nil, "A queued run has no server error")
    }

    private func agent(_ id: String) -> Agent {
        Agent(
            id: id, name: id, instructions: "Help", character: "moss", model: "fixture", kind: nil)
    }
}
