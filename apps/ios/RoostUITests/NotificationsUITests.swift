import XCTest

final class NotificationsUITests: XCTestCase {
    private enum Failure: Error { case unavailable(String) }

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
            throw Failure.unavailable(element.description)
        }
        return element
    }

    @MainActor private func field(_ element: XCUIElement) throws -> XCUIElement {
        guard element.waitForExistence(timeout: 10) else {
            throw Failure.unavailable(element.description)
        }
        return element
    }

    @MainActor func testSharedNotificationPreferencesPersistWithoutRequestingPushPermission()
        async throws
    {
        continueAfterFailure = true
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, resetResponse) = try await URLSession.shared.data(for: reset)
        guard (resetResponse as? HTTPURLResponse)?.statusCode == 204 else {
            throw Failure.unavailable("Fixture reset failed")
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
        try ready(app.buttons["notificationSettings"]).tap()

        let completed = try ready(app.switches["Completed responses"], value: "1")
        completed.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        _ = try ready(completed, value: "0")
        let notifications = try ready(app.switches["Notifications"], value: "1")
        notifications.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        _ = try ready(notifications, value: "0")
        XCTAssertFalse(completed.isEnabled)
        XCTAssertFalse(app.switches["Agent updates"].isEnabled)
        XCTAssertFalse(app.switches["Approvals and failures"].isEnabled)

        var request = URLRequest(
            url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/settings/notifications")!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Failure.unavailable("Could not verify saved notification preferences")
        }
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Bool])
        XCTAssertEqual(
            saved,
            [
                "enabled": false, "turnCompleted": false, "agentUpdates": true,
                "needsAttention": true,
            ])
        let capability = app.staticTexts[
            "This build needs the Push Notifications capability. Install a signed build configured for APNs to enable iPhone notifications."
        ]
        _ = try field(capability)
        if !capability.isHittable { app.swipeUp() }
        _ = try ready(capability)
        XCTAssertFalse(app.buttons["enableNativePush"].exists)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertFalse(
            springboard.alerts
                .matching(
                    NSPredicate(
                        format: "label CONTAINS[c] 'Roost' AND label CONTAINS[c] 'Notifications'")
                )
                .firstMatch.exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Native notification preferences and push capability"
        screenshot.lifetime = .keepAlways
        add(screenshot)

        app.terminate()
        app.launchArguments = []
        app.launch()
        _ = try ready(app.buttons["agent-Moss"])
        try ready(app.buttons["Settings"]).tap()
        try ready(app.buttons["notificationSettings"]).tap()
        _ = try ready(app.switches["Notifications"], value: "0")
        XCTAssertEqual(app.switches["Completed responses"].value as? String, "0")
        XCTAssertEqual(app.switches["Agent updates"].value as? String, "1")
        XCTAssertEqual(app.switches["Approvals and failures"].value as? String, "1")
        XCTAssertFalse(app.buttons["enableNativePush"].exists)
    }
}
