import XCTest

final class RoostUITests: XCTestCase {
    @MainActor func testConnectChatReplyAndApprove() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, resetResponse) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((resetResponse as? HTTPURLResponse)?.statusCode, 204)
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        let onboarding = XCTAttachment(screenshot: app.screenshot())
        onboarding.name = "Connect"
        onboarding.lifetime = .keepAlways
        add(onboarding)
        let server = app.textFields["serverAddress"]
        XCTAssertTrue(server.waitForExistence(timeout: 10))
        server.tap()
        server.typeText("http://127.0.0.1:4399")
        let token = app.secureTextFields["deviceToken"]
        token.tap()
        token.typeText("roost_mobile_" + String(repeating: "a", count: 43))
        app.buttons["connectButton"].tap()
        let moss = app.buttons["agent-Moss"]
        XCTAssertTrue(moss.waitForExistence(timeout: 15))
        let agents = XCTAttachment(screenshot: app.screenshot())
        agents.name = "Agents"
        agents.lifetime = .keepAlways
        add(agents)
        moss.tap()
        XCTAssertTrue(
            app.staticTexts["The garden is ready for a fresh start."].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["You"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["toolActivity"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["typingIndicator"].exists)
        XCTAssertGreaterThan(
            app.staticTexts["How is the balcony garden looking?"].frame.minX,
            app.staticTexts["The garden is ready for a fresh start."].frame.minX
        )
        let conversation = XCTAttachment(screenshot: app.screenshot())
        conversation.name = "Conversation"
        conversation.lifetime = .keepAlways
        add(conversation)
        let composer = app.textFields["messageComposer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("Let's plan the week")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts["Let's plan the week"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts.matching(identifier: "Let's plan the week").count, 1)
        let approve = app.buttons["approveOnce"]
        if !approve.isHittable { app.swipeUp() }
        XCTAssertTrue(approve.waitForExistence(timeout: 10))
        approve.tap()
        XCTAssertTrue(app.staticTexts["Approved once"].waitForExistence(timeout: 10))
        XCTAssertTrue(
            app.descendants(matching: .any)["typingIndicator"].firstMatch
                .waitForExistence(timeout: 10)
        )
        XCTAssertFalse(app.staticTexts["Moss is working…"].exists)
        XCTAssertFalse(app.staticTexts["Queued"].exists)
        XCTAssertFalse(app.buttons["Reply"].exists)
        let userMessage = app.staticTexts["Let's plan the week"]
        userMessage.swipeRight()
        XCTAssertFalse(app.staticTexts["Continue in this thread"].exists)
        let assistantMessage = app.staticTexts["The garden is ready for a fresh start."]
        if !assistantMessage.isHittable { app.swipeDown() }
        assistantMessage.swipeRight()
        XCTAssertTrue(app.staticTexts["Continue in this thread"].waitForExistence(timeout: 10))
        let threadComposer = app.textFields["messageComposer"]
        threadComposer.tap()
        threadComposer.typeText("Focus on the balcony")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts["Focus on the balcony"].waitForExistence(timeout: 10))
        let reply = XCTAttachment(screenshot: app.screenshot())
        reply.name = "Reply thread"
        reply.lifetime = .keepAlways
        add(reply)
        app.terminate()
        app.launchArguments = ["-appearance", "dark"]
        app.launch()
        XCTAssertTrue(app.buttons["agent-Moss"].waitForExistence(timeout: 10))
        app.buttons["agent-Moss"].tap()
        XCTAssertTrue(app.staticTexts["Let's plan the week"].waitForExistence(timeout: 10))
        let dark = XCTAttachment(screenshot: app.screenshot())
        dark.name = "Conversation dark"
        dark.lifetime = .keepAlways
        add(dark)
        app.navigationBars.buttons["Roost"].tap()
        app.buttons["Settings"].tap()
        app.buttons["responseStylePicker"].tap()
        app.buttons["Codex"].tap()
        app.navigationBars["Settings"].buttons["Done"].tap()
        app.buttons["agent-Moss"].tap()
        XCTAssertTrue(app.staticTexts["You"].firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["toolActivity"].firstMatch.exists)

        // Remove launch-only appearance overrides before testing saved settings.
        app.terminate()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(app.buttons["agent-Moss"].waitForExistence(timeout: 10))
        app.buttons["Settings"].tap()
        app.buttons["colorThemePicker"].tap()
        for theme in ["default", "rose-pine", "carbonfox", "catppuccin"] {
            app.buttons["theme-" + theme].tap()
            XCTAssertTrue(app.buttons["theme-" + theme].isSelected)
            for mode in ["Light", "Dark"] {
                app.segmentedControls["themeAppearance"].buttons[mode].tap()
                let screenshot = XCTAttachment(screenshot: app.screenshot())
                screenshot.name = "Theme \(theme) \(mode)"
                screenshot.lifetime = .keepAlways
                add(screenshot)
            }
        }
        app.navigationBars["Theme"].buttons["Settings"].tap()
        app.buttons["responseStylePicker"].tap()
        app.buttons["Messages"].tap()
        app.navigationBars["Settings"].buttons["Done"].tap()
        app.buttons["agent-Moss"].tap()
        XCTAssertTrue(app.staticTexts["Let's plan the week"].waitForExistence(timeout: 10))
        let themedConversation = XCTAttachment(screenshot: app.screenshot())
        themedConversation.name = "Catppuccin conversation"
        themedConversation.lifetime = .keepAlways
        add(themedConversation)

        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["agent-Moss"].waitForExistence(timeout: 10))
        app.buttons["Settings"].tap()
        app.buttons["colorThemePicker"].tap()
        XCTAssertTrue(app.buttons["theme-catppuccin"].isSelected)
        XCTAssertTrue(app.segmentedControls["themeAppearance"].buttons["Dark"].isSelected)

        app.navigationBars["Theme"].buttons["Settings"].tap()
        app.navigationBars["Settings"].buttons["Done"].tap()
        app.buttons["agent-Moss"].tap()
        var interrupted = URLRequest(
            url: URL(string: "http://127.0.0.1:4399/__fixture/lose-next-send-response")!)
        interrupted.httpMethod = "POST"
        interrupted.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, interruptedResponse) = try await URLSession.shared.data(for: interrupted)
        XCTAssertEqual((interruptedResponse as? HTTPURLResponse)?.statusCode, 204)
        let retryText = "Keep this message exactly once, even if delivery is interrupted."
        app.textFields["messageComposer"].tap()
        app.textFields["messageComposer"].typeText(retryText)
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(
            app.staticTexts["Delivery is unconfirmed. Retry safely with the same message."]
                .waitForExistence(timeout: 10))
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["agent-Moss"].waitForExistence(timeout: 10))
        app.buttons["agent-Moss"].tap()
        XCTAssertTrue(app.buttons["sendMessage"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["sendMessage"].label, "Retry message")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts[retryText].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts.matching(identifier: retryText).count, 1)
        XCTAssertFalse(
            app.staticTexts["Delivery is unconfirmed. Retry safely with the same message."].exists)

        app.terminate()
        app.launchArguments = ["-ui-testing-reduce-motion"]
        app.launch()
        XCTAssertTrue(app.buttons["agent-Moss"].waitForExistence(timeout: 10))
        app.buttons["agent-Moss"].tap()
        let multiline = "A calmer send.\nWith room for another line."
        app.textFields["messageComposer"].tap()
        app.textFields["messageComposer"].typeText(multiline)
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts[multiline].waitForExistence(timeout: 10))
        XCTAssertEqual(app.staticTexts.matching(identifier: multiline).count, 1)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        let reduced = XCTAttachment(screenshot: app.screenshot())
        reduced.name = "Reduced motion multiline send"
        reduced.lifetime = .keepAlways
        add(reduced)
    }
}
