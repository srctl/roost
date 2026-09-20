import XCTest

final class CodingSettingsUITests: XCTestCase {
    private enum Failure: Error {
        case unavailable(String)
        case unexpectedStatus(Int?)
    }
    private struct AgentResult: Decodable {
        let id: String
        let name: String
        let kind: String?
    }
    private struct Configuration: Decodable {
        struct Settings: Decodable {
            let repository: String
            let projectInstructions: String
        }
        let settings: Settings
    }
    private struct Profile: Decodable {
        let id: String
        let name: String
        let kind: String
        let target: String
        let instructions: String
        let revision: Int
    }

    @MainActor private func ready(_ element: XCUIElement, timeout: TimeInterval = 10) throws {
        let expectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(
                format: "exists == true AND hittable == true AND enabled == true"),
            object: element)
        guard XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed else {
            throw Failure.unavailable(element.description)
        }
    }

    @MainActor private func tap(_ element: XCUIElement) throws {
        guard element.waitForExistence(timeout: 10) else {
            throw Failure.unavailable(element.description)
        }
        if [.textField, .secureTextField, .textView].contains(element.elementType)
            || element.identifier == "connectButton"
        {
            element.tap()
        } else {
            try ready(element)
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

    @MainActor private func editor(_ name: String, in app: XCUIApplication) throws -> XCUIElement {
        let field = app.descendants(matching: .any).matching(identifier: name)
            .matching(
                NSPredicate(
                    format: "elementType == %d OR elementType == %d",
                    XCUIElement.ElementType.textField.rawValue,
                    XCUIElement.ElementType.textView.rawValue)
            )
            .firstMatch
        guard field.waitForExistence(timeout: 10) else { throw Failure.unavailable(name) }
        return field
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
            let result = try JSONDecoder().decode(T.self, from: data)
            if matches?(result) != false { return result }
            try await Task.sleep(for: .milliseconds(200))
        }
        throw Failure.unavailable("Persisted change at " + path)
    }

    @MainActor private func openSettings(_ app: XCUIApplication) throws {
        try ready(app.buttons["agent-Wisp"], timeout: 15)
        try tap(app.buttons["agent-Wisp"])
        try tap(app.buttons["workspace-more"])
        try tap(app.buttons["openCodingSettings"])
        _ = try editor("coding-repository", in: app)
    }

    @MainActor func testProjectAndLocalExecutionProfilePersistAcrossRelaunch() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        // Only this disposable local fixture is mutated; saving a profile does
        // not start a coding job, contact a repository, or make an SSH connection.
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
        try openSettings(app)

        let repository = "https://example.com/roost/fixture.git"
        let instructions = "Keep changes small and run the focused tests."
        let repositoryField = try editor("coding-repository", in: app)
        try tap(repositoryField)
        repositoryField.typeText(repository)
        let instructionsField = try editor("coding-project-instructions", in: app)
        try tap(instructionsField)
        instructionsField.typeText(instructions)
        try tap(app.navigationBars["Coding project"].buttons["Save"])

        let agents: [AgentResult] = try await get("agents")
        let agent = try XCTUnwrap(agents.first { $0.name == "Wisp" && $0.kind == "coding" })
        let stored: Configuration = try await get(
            "agents/\(agent.id)/coding-settings",
            until: {
                $0.settings.repository == repository
                    && $0.settings.projectInstructions == instructions
            })
        XCTAssertEqual(stored.settings.repository, repository)
        XCTAssertEqual(stored.settings.projectInstructions, instructions)

        // Relaunch dismisses the keyboard and proves the form is hydrated from
        // the server rather than the preceding view's local state.
        app.terminate()
        app.launchArguments = []
        app.launch()
        try openSettings(app)
        XCTAssertEqual(try editor("coding-repository", in: app).value as? String, repository)
        XCTAssertEqual(
            try editor("coding-project-instructions", in: app).value as? String, instructions)
        XCTAssertEqual(
            try editor("coding-project-instructions", in: app).label, "Project instructions")
        let addProfile = app.buttons["Add execution profile"]
        for _ in 0..<4 where !addProfile.isHittable { app.swipeUp() }
        try tap(addProfile)
        let profileName = try editor("execution-profile-name", in: app)
        try tap(profileName)
        profileName.typeText("Pocket local")
        let executionInstructions = try editor("execution-profile-instructions", in: app)
        try tap(executionInstructions)
        executionInstructions.typeText("Use the existing local checkout.")
        try tap(app.navigationBars["New profile"].buttons["Save"])
        let profiles: [Profile] = try await get(
            "execution-profiles", until: { $0.contains { $0.name == "Pocket local" } })
        let profile = try XCTUnwrap(profiles.first { $0.name == "Pocket local" })
        XCTAssertEqual(profile.kind, "local")
        XCTAssertEqual(profile.target, "")
        XCTAssertEqual(profile.instructions, "Use the existing local checkout.")

        let row = app.buttons["execution-profile-\(profile.id)"]
        for _ in 0..<4 where !row.isHittable { app.swipeUp() }
        try tap(row)
        let nameEditor = try editor("execution-profile-name", in: app)
        XCTAssertEqual(nameEditor.value as? String, "Pocket local")
        XCTAssertEqual(
            try editor("execution-profile-instructions", in: app).value as? String,
            "Use the existing local checkout.")
        try tap(nameEditor)
        nameEditor.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        nameEditor.typeText(" verified")
        try tap(app.navigationBars["Execution profile"].buttons["Save"])
        let updated: [Profile] = try await get(
            "execution-profiles",
            until: { $0.contains { $0.id == profile.id && $0.name == "Pocket local verified" } })
        XCTAssertGreaterThan(
            try XCTUnwrap(updated.first { $0.id == profile.id }).revision, profile.revision)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native coding project and local execution profile"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
