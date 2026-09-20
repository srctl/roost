import XCTest

final class PaymentsUITests: XCTestCase {
    @MainActor func testPaymentsFromSettingsAndAgentConversation() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 204)
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        let server = app.textFields["serverAddress"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        server.tap()
        server.typeText("http://127.0.0.1:4399")
        app.secureTextFields["deviceToken"].tap()
        app.secureTextFields["deviceToken"]
            .typeText("roost_mobile_" + String(repeating: "a", count: 43))
        app.buttons["connectButton"].tap()
        XCTAssertTrue(app.buttons["agent-Moss"].waitForExistence(timeout: 15))

        app.buttons["Settings"].tap()
        app.buttons["paymentsSettings"].tap()
        XCTAssertTrue(app.buttons["connectLink"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Not connected"].exists)
        XCTAssertEqual(app.staticTexts["paymentPurchasesHeader"].label.lowercased(), "purchases")
        let settings = XCTAttachment(screenshot: app.screenshot())
        settings.name = "Native payments settings"
        settings.lifetime = .keepAlways
        add(settings)

        app.navigationBars["Payments"].buttons["Settings"].tap()
        app.navigationBars["Settings"].buttons["Done"].tap()
        app.buttons["agent-Moss"].tap()
        app.buttons["Agent payments"].tap()
        XCTAssertTrue(app.staticTexts["paymentPurchasesHeader"].waitForExistence(timeout: 10))
        XCTAssertEqual(
            app.staticTexts["paymentPurchasesHeader"].label.lowercased(), "this agent’s purchases")
        XCTAssertTrue(app.buttons["connectLink"].exists)
        let agent = XCTAttachment(screenshot: app.screenshot())
        agent.name = "Native agent payments"
        agent.lifetime = .keepAlways
        add(agent)
    }
}
