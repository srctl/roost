import XCTest

final class CodexConnectionUITests: XCTestCase {
    private enum Failure: Error { case unavailable(String) }
    @MainActor private func tap(_ element: XCUIElement) throws {
        guard element.waitForExistence(timeout: 10) else {
            throw Failure.unavailable(element.description)
        }
        if [.textField, .secureTextField, .textView].contains(element.elementType)
            || element.identifier == "connectButton"
        {
            element.tap()
            return
        }
        let visible = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "hittable == true AND enabled == true"), object: element)
        guard XCTWaiter.wait(for: [visible], timeout: 10) == .completed else {
            throw Failure.unavailable(element.description)
        }
        element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    @MainActor func testConnectAndCancelCodexSignInWithoutLeavingApp() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, response) = try await URLSession.shared.data(for: reset)
        guard (response as? HTTPURLResponse)?.statusCode == 204 else {
            throw Failure.unavailable("Fixture reset")
        }
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        try tap(app.textFields["serverAddress"])
        app.textFields["serverAddress"].typeText("http://127.0.0.1:4399")
        try tap(app.secureTextFields["deviceToken"])
        app.secureTextFields["deviceToken"]
            .typeText("roost_mobile_" + String(repeating: "a", count: 43))
        try tap(app.buttons["connectButton"])
        guard app.buttons["agent-Moss"].waitForExistence(timeout: 15) else {
            throw Failure.unavailable("Agents")
        }
        try tap(app.buttons["Settings"])
        try tap(app.buttons["codexConnectionSettings"])
        try tap(app.buttons["connectCodex"])
        let code = app.descendants(matching: .any)["codexDeviceCode"].firstMatch
        guard code.waitForExistence(timeout: 10) else {
            throw Failure.unavailable("Device code")
        }
        XCTAssertEqual(code.value as? String, "TEST-CODE")
        XCTAssertTrue(
            app.links["Open ChatGPT sign-in"].exists || app.buttons["Open ChatGPT sign-in"].exists)
        try tap(app.buttons["Copy code"])
        XCTAssertTrue(app.buttons["Code copied"].exists)
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Native Codex device sign-in"
        shot.lifetime = .keepAlways
        add(shot)
        try tap(app.buttons["Cancel sign-in"])
        guard app.buttons["connectCodex"].waitForExistence(timeout: 10) else {
            throw Failure.unavailable("Cancelled sign-in")
        }
        XCTAssertFalse(app.descendants(matching: .any)["codexDeviceCode"].firstMatch.exists)
        var request = URLRequest(
            url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/account/login")!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        let login = try JSONDecoder().decode([String: String].self, from: data)
        XCTAssertEqual(login["status"], "idle")
    }
}
