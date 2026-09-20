import XCTest

final class AgentManagementUITests: XCTestCase {
    private enum Failure: Error {
        case timedOut(String)
        case unexpectedStatus(Int?)
    }
    private struct AgentResult: Decodable {
        let id: String
        let name: String
    }
    private struct NavigationResult: Decodable {
        struct Section: Decodable {
            let id: String
            let name: String
        }
        let sections: [Section]
        let memberships: [String: String]
    }
    private struct IdentityResult: Decodable {
        struct Soul: Decodable { let content: String }
        struct Change: Decodable { let id: String }
        struct Reflection: Decodable { let intervalMinutes: Int }
        let soul: Soul
        let changes: [Change]
        let reflection: Reflection
    }

    // Async tests must throw on a failed prerequisite. XCTest assertions alone
    // can leave their continuation alive while the next test starts using the UI.
    @MainActor private func ready(_ element: XCUIElement, timeout: TimeInterval = 10) throws {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(
                format: "exists == true AND hittable == true AND enabled == true"), object: element)
        guard XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed else {
            throw Failure.timedOut("Control is not ready: " + element.description)
        }
    }
    @MainActor private func tap(_ element: XCUIElement) throws {
        try exists(element)
        if [.textField, .secureTextField, .textView].contains(element.elementType)
            || element.identifier == "connectButton"
        {
            element.tap()
        } else {
            try ready(element)
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }
    @MainActor private func exists(_ element: XCUIElement, timeout: TimeInterval = 10) throws {
        guard element.waitForExistence(timeout: timeout) else {
            throw Failure.timedOut(element.description)
        }
    }

    @MainActor private func connect() async throws -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, response) = try await URLSession.shared.data(for: reset)
        guard (response as? HTTPURLResponse)?.statusCode == 204 else {
            throw Failure.unexpectedStatus((response as? HTTPURLResponse)?.statusCode)
        }
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        try tap(app.textFields["serverAddress"])
        app.textFields["serverAddress"].typeText("http://127.0.0.1:4399")
        try tap(app.secureTextFields["deviceToken"])
        app.secureTextFields["deviceToken"]
            .typeText("roost_mobile_" + String(repeating: "a", count: 43))
        try tap(app.buttons["connectButton"])
        try ready(app.buttons["agent-Moss"], timeout: 15)
        return app
    }

    private func get<T: Decodable>(_ path: String, until matches: ((T) -> Bool)? = nil) async throws
        -> T
    {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/" + path)!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        for _ in 0..<40 {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw Failure.unexpectedStatus((response as? HTTPURLResponse)?.statusCode)
            }
            let value = try JSONDecoder().decode(T.self, from: data)
            if matches?(value) != false { return value }
            try await Task.sleep(for: .milliseconds(200))
        }
        throw Failure.timedOut("Persisted change at " + path)
    }

    @MainActor func testCreateRenameGroupAndDeleteAgent() async throws {
        let app = try await connect()
        try tap(app.buttons["Add agent or section"])
        try tap(app.buttons["New agent"])
        let name = app.textFields["new-agent-name"]
        try tap(name)
        name.typeText("Pocket Scout")
        let instructions = app.descendants(matching: .any)["new-agent-instructions"].firstMatch
        try tap(instructions)
        instructions.typeText("Compare ideas and bring back a clear recommendation.")
        try tap(app.buttons["create-agent"])
        try exists(app.navigationBars["Pocket Scout"], timeout: 15)
        try tap(app.navigationBars.buttons["Roost"])
        let created = app.buttons["agent-Pocket Scout"]
        try ready(created)
        created.swipeLeft()
        try tap(app.buttons["Rename"])
        let rename = app.textFields["agent-name-editor"]
        try tap(rename)
        rename.typeText(
            String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Pocket Scout".count)
                + "Pocket Guide")
        try tap(app.navigationBars["Rename agent"].buttons["Save"])
        try ready(app.buttons["agent-Pocket Guide"])

        try tap(app.buttons["Add agent or section"])
        try tap(app.buttons["New section"])
        let sectionName = app.textFields["agent-name-editor"]
        try tap(sectionName)
        sectionName.typeText("Personal")
        try tap(app.navigationBars["New section"].buttons["Save"])
        try ready(app.buttons["Collapse Personal"])
        try ready(app.buttons["agent-Pocket Guide"])
        app.buttons["agent-Pocket Guide"].press(forDuration: 1)
        try tap(app.buttons["Move to section"])
        try tap(app.buttons["Personal"])
        let agents: [AgentResult] = try await get("agents")
        let id = try XCTUnwrap(agents.first { $0.name == "Pocket Guide" }).id
        let navigation: NavigationResult = try await get(
            "agent-navigation", until: { $0.memberships[id] != nil })
        let sectionId = try XCTUnwrap(navigation.sections.first { $0.name == "Personal" }).id
        XCTAssertEqual(navigation.memberships[id], sectionId)
        try tap(app.buttons["Collapse Personal"])
        try tap(app.buttons["Expand Personal"])
        try ready(app.buttons["agent-Pocket Guide"])
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native agent sections"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.buttons["agent-Pocket Guide"].swipeLeft()
        try tap(app.buttons["Delete"])
        let confirmation = app.textFields["delete-agent-confirmation"]
        try ready(confirmation)
        XCTAssertFalse(app.buttons["confirm-delete-agent"].isEnabled)
        // Opening a confirmation must not optimistically remove the List row.
        try tap(app.navigationBars["Delete agent?"].buttons["Cancel"])
        try ready(app.buttons["agent-Pocket Guide"])
        app.buttons["agent-Pocket Guide"].swipeLeft()
        try tap(app.buttons["Delete"])
        try tap(confirmation)
        confirmation.typeText("Pocket Guide")
        try tap(app.buttons["confirm-delete-agent"])
        let remaining: [AgentResult] = try await get(
            "agents", until: { !$0.contains { $0.id == id } })
        XCTAssertFalse(remaining.contains { $0.id == id })
        // A successful API mutation alone can hide a UICollectionView crash.
        // Wait for the sheet and deleted row to disappear, then use the list.
        let removed = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                app.state == .runningForeground
                    && !confirmation.exists && !app.buttons["agent-Pocket Guide"].exists
            }, object: app)
        guard XCTWaiter.wait(for: [removed], timeout: 10) == .completed else {
            throw Failure.timedOut("Agent deletion did not return to the live agent list")
        }
        try ready(app.buttons["agent-Moss"])
        XCTAssertEqual(app.state, .runningForeground)
        try tap(app.buttons["agent-Moss"])
        try exists(app.navigationBars["Moss"])
        XCTAssertEqual(app.state, .runningForeground)
    }

    @MainActor func testEditAgentSoulAndPersistReflectionSchedule() async throws {
        let app = try await connect()
        try tap(app.buttons["agent-Moss"])
        try tap(app.buttons["workspace-more"])
        try tap(app.buttons["openAgentIdentity"])
        try tap(app.buttons["Edit soul"])
        let editor = app.textViews["agent-soul-editor"]
        try tap(editor)
        editor.typeText("\nNative identity verification.")
        try tap(app.navigationBars["Edit soul"].buttons["Save"])
        try ready(app.buttons["Edit soul"])
        let agents: [AgentResult] = try await get("agents")
        let id = try XCTUnwrap(agents.first { $0.name == "Moss" }).id
        let identity: IdentityResult = try await get("agents/\(id)/identity")
        XCTAssertTrue(identity.soul.content.contains("Native identity verification."))
        XCTAssertEqual(identity.changes.count, 1)
        try exists(app.buttons["agent-reflection-interval"])
        app.buttons["agent-reflection-interval"].tap()
        try tap(app.buttons["Daily"])
        try exists(app.buttons["Save reflection schedule"])
        app.buttons["Save reflection schedule"].tap()
        let updated: IdentityResult = try await get(
            "agents/\(id)/identity", until: { $0.reflection.intervalMinutes == 1440 })
        XCTAssertEqual(updated.reflection.intervalMinutes, 1440)
    }
}
