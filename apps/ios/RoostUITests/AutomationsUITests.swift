import XCTest

final class AutomationsUITests: XCTestCase {
    private enum TestFailure: Error { case unavailable(String) }

    // A synchronous waiter prevents a failed async fulfillment from leaving
    // this workflow running while XCTest begins the next fixture-backed test.
    @MainActor private func ready(
        _ element: XCUIElement, timeout: TimeInterval = 10, value: String? = nil
    ) throws
        -> XCUIElement
    {
        let expectation = XCTNSPredicateExpectation(
            predicate: value.map {
                NSPredicate(
                    format:
                        "exists == true AND hittable == true AND enabled == true AND value == %@",
                    $0)
            } ?? NSPredicate(format: "exists == true AND hittable == true AND enabled == true"),
            object: element)
        guard XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed else {
            XCTFail("UI control did not become ready: " + element.description)
            throw TestFailure.unavailable(element.description)
        }
        return element
    }

    @MainActor private func field(_ element: XCUIElement) throws -> XCUIElement {
        guard element.waitForExistence(timeout: 10) else {
            XCTFail("Text field did not appear: " + element.description)
            throw TestFailure.unavailable(element.description)
        }
        return element
    }

    @MainActor func testCreateEditPauseRunAndDeleteAutomation() async throws {
        continueAfterFailure = true
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, response) = try await URLSession.shared.data(for: reset)
        guard (response as? HTTPURLResponse)?.statusCode == 204 else {
            throw TestFailure.unavailable("Fixture reset failed")
        }
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        let server = app.textFields["serverAddress"]
        try field(server).tap()
        server.typeText("http://127.0.0.1:4399")
        try field(app.secureTextFields["deviceToken"]).tap()
        app.secureTextFields["deviceToken"]
            .typeText("roost_mobile_" + String(repeating: "a", count: 43))
        try field(app.buttons["connectButton"]).tap()
        try ready(app.buttons["agent-Moss"], timeout: 15).tap()
        try ready(app.buttons["workspace-more"]).tap()
        try ready(app.buttons["openAutomations"]).tap()
        try ready(app.buttons["newAutomation"]).tap()
        let name = app.textFields["automationName"]
        try field(name).tap()
        name.typeText("Morning garden check")
        let prompt =
            app.textViews["automationPrompt"].exists
            ? app.textViews["automationPrompt"] : app.textFields["automationPrompt"]
        try field(prompt).tap()
        prompt.typeText("Check the balcony plants and report what needs watering.")
        let save = app.buttons["saveAutomation"]
        try ready(save).tap()
        try ready(app.staticTexts["Morning garden check"]).tap()
        _ = try ready(app.navigationBars["Morning garden check"])
        let pause = app.buttons["Pause automation"]
        if !pause.isHittable { app.swipeUp() }
        try ready(pause).tap()
        _ = try ready(app.buttons["Resume automation"])
        let details = XCTAttachment(screenshot: app.screenshot())
        details.name = "Native automation details"
        details.lifetime = .keepAlways
        add(details)
        try ready(app.buttons["Edit"]).tap()
        try field(name).tap()
        name.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        name.typeText(
            String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Morning garden check".count))
        name.typeText("Weekly garden check")
        try ready(app.buttons["saveAutomation"]).tap()
        _ = try ready(app.navigationBars["Weekly garden check"])
        let run = app.buttons["Run now"]
        if !run.isHittable { app.swipeUp() }
        try ready(run).tap()
        try ready(app.navigationBars.buttons["Automations"]).tap()
        app.swipeUp()
        let queued = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Queued'"))
            .firstMatch
        try ready(queued).tap()
        _ = try ready(app.navigationBars["Run details"])
        try ready(app.buttons["Stop run"]).tap()
        _ = try ready(
            app.descendants(matching: .any)["automationRunStatus"].firstMatch, value: "Cancelled")
        try ready(app.navigationBars.buttons["Automations"]).tap()
        app.swipeDown()
        try ready(app.staticTexts["Weekly garden check"].firstMatch).tap()
        _ = try ready(app.navigationBars["Weekly garden check"])
        let delete = app.buttons["Delete automation"]
        if !delete.isHittable { app.swipeUp() }
        try ready(delete).tap()
        let confirmation = app.sheets.buttons["Delete automation"]
        try ready(confirmation).tap()
        _ = try ready(app.staticTexts["Make time for what matters"])
        let history = XCTAttachment(screenshot: app.screenshot())
        history.name = "Native automation history after deletion"
        history.lifetime = .keepAlways
        add(history)
    }
}
