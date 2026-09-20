import XCTest

final class ServerPreferencesUITests: XCTestCase {
    private enum TestFailure: Error { case unavailable(String) }

    @MainActor private func ready(_ element: XCUIElement, value: String? = nil) throws
        -> XCUIElement
    {
        let condition = XCTNSPredicateExpectation(
            predicate: value.map {
                NSPredicate(
                    format:
                        "exists == true AND hittable == true AND enabled == true AND value == %@",
                    $0)
            } ?? NSPredicate(format: "exists == true AND hittable == true AND enabled == true"),
            object: element)
        guard XCTWaiter.wait(for: [condition], timeout: 10) == .completed else {
            XCTFail("Control did not become ready: " + element.description)
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

    @MainActor func testDisplayPreferencesPersistAndShareDashboardSetting() async throws {
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
        try field(app.textFields["serverAddress"]).tap()
        app.textFields["serverAddress"].typeText("http://127.0.0.1:4399")
        try field(app.secureTextFields["deviceToken"]).tap()
        app.secureTextFields["deviceToken"]
            .typeText("roost_mobile_" + String(repeating: "a", count: 43))
        try field(app.buttons["connectButton"]).tap()
        _ = try ready(app.buttons["agent-Moss"])
        try ready(app.buttons["Settings"]).tap()
        try ready(app.buttons["displayPreferences"]).tap()
        let activity = try ready(app.switches["showActivityDetails"])
        if activity.value as? String != "1" {
            activity.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        }
        _ = try ready(activity, value: "1")
        let dashboards = try ready(app.switches["dashboardsEnabled"])
        if dashboards.value as? String == "1" {
            dashboards.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        }
        _ = try ready(dashboards, value: "0")
        var request = URLRequest(
            url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/settings/dashboards")!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Bool])
        XCTAssertEqual(value["enabled"], false)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native display preferences"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        app.terminate()
        app.launchArguments = []
        app.launch()
        _ = try ready(app.buttons["agent-Moss"])
        try ready(app.buttons["Settings"]).tap()
        try ready(app.buttons["displayPreferences"]).tap()
        XCTAssertEqual(try ready(app.switches["showActivityDetails"]).value as? String, "1")
        XCTAssertEqual(try ready(app.switches["dashboardsEnabled"]).value as? String, "0")
    }
}
