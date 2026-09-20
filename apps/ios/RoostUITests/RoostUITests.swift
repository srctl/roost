import XCTest

final class RoostUITests: XCTestCase {
    private enum Failure: Error { case expectation(String) }

    @MainActor private func stopAfterRecordedFailure() throws {
        // XCTest UI actions can record a failure without throwing into an async
        // test. Stop its task before it can mutate the next test's application.
        guard (testRun?.totalFailureCount ?? 0) == 0 else {
            throw Failure.expectation("A preceding XCTest UI action failed")
        }
    }

    @MainActor private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws
    {
        try stopAfterRecordedFailure()
        guard condition() else { throw Failure.expectation(message) }
    }

    @MainActor private func exists(_ element: XCUIElement, timeout: TimeInterval = 10) throws {
        try stopAfterRecordedFailure()
        if element.exists { return }
        guard element.waitForExistence(timeout: timeout) else {
            throw Failure.expectation("Missing element: " + element.description)
        }
        try stopAfterRecordedFailure()
    }

    @MainActor private func ready(
        _ element: XCUIElement, timeout: TimeInterval = 10, mustBeHittable: Bool = true
    ) throws {
        try stopAfterRecordedFailure()
        let predicate = NSPredicate(
            format: mustBeHittable
                ? "exists == true AND hittable == true AND enabled == true"
                : "exists == true AND enabled == true")
        if predicate.evaluate(with: element) { return }
        let ready = XCTNSPredicateExpectation(predicate: predicate, object: element)
        guard XCTWaiter.wait(for: [ready], timeout: timeout) == .completed else {
            throw Failure.expectation("Control is not ready: " + element.description)
        }
        try stopAfterRecordedFailure()
    }

    @MainActor private func tap(_ element: XCUIElement, scrollable: Bool = false) throws {
        try exists(element)
        if scrollable || [.textField, .secureTextField, .textView].contains(element.elementType)
            || element.identifier == "connectButton"
        {
            try ready(element, mustBeHittable: false)
            // Native tapping scrolls keyboard-covered fields and Form rows into view.
            element.tap()
        } else {
            try ready(element)
            // Navigation controls can report invalid AX scroll targets mid-transition.
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        try stopAfterRecordedFailure()
    }

    @MainActor private func openMoss(_ app: XCUIApplication) throws {
        try tap(app.buttons["agent-Moss"])
        try exists(app.navigationBars["Moss"])
        try exists(app.textFields["messageComposer"])
    }

    private struct AgentReceipt: Decodable {
        let id: String
        let name: String
    }
    private struct ConversationReceipt: Decodable {
        struct Entry: Decodable {
            struct Message: Decodable {
                let role: String
                let text: String
            }
            let message: Message
        }
        let entries: [Entry]
    }

    private func fixtureValue<T: Decodable>(_ path: String) async throws -> T {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/" + path)!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Failure.expectation("Could not verify persisted messages at " + path)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    @MainActor private func verifyOneMessage(_ text: String, in app: XCUIApplication) async throws {
        let agents: [AgentReceipt] = try await fixtureValue("agents")
        guard let moss = agents.first(where: { $0.name == "Moss" }) else {
            throw Failure.expectation("Fixture Moss agent is missing")
        }
        var savedCount = 0
        for attempt in 0..<25 {
            let snapshot: ConversationReceipt = try await fixtureValue(
                "agents/\(moss.id)/conversation")
            savedCount =
                snapshot.entries
                .filter {
                    $0.message.role == "user" && $0.message.text == text
                }
                .count
            if savedCount != 0 { break }
            if attempt < 24 { try await Task.sleep(for: .milliseconds(200)) }
        }
        try require(
            savedCount == 1, "Server should retain exactly one message; found \(savedCount)")
        try verifyOneRenderedMessage(text, in: app)
    }

    @MainActor private func verifyOneRenderedMessage(_ text: String, in app: XCUIApplication) throws
    {
        let matches = app.staticTexts.matching(identifier: text)
        var consecutiveMatches = 0
        let rendered = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                consecutiveMatches = matches.count == 1 ? consecutiveMatches + 1 : 0
                return consecutiveMatches >= 2
            }, object: app)
        guard XCTWaiter.wait(for: [rendered], timeout: 10) == .completed else {
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "Message render accessibility hierarchy"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "Message render count \(matches.count)"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            throw Failure.expectation(
                "Rendered message should appear exactly once; found \(matches.count)")
        }
        // Wait for the send/flight presentation to settle before counting the
        // authoritative row. Preserve the exact-one check after the wait too.
        try require(
            matches.count == 1, "Rendered message changed after settling; found \(matches.count)")
    }

    @MainActor func testConnectChatReplyAndApprove() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, resetResponse) = try await URLSession.shared.data(for: reset)
        try require((resetResponse as? HTTPURLResponse)?.statusCode == 204, "Fixture reset failed")
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        let onboarding = XCTAttachment(screenshot: app.screenshot())
        onboarding.name = "Connect"
        onboarding.lifetime = .keepAlways
        add(onboarding)
        let server = app.textFields["serverAddress"]
        try tap(server)
        server.typeText("http://127.0.0.1:4399")
        let token = app.secureTextFields["deviceToken"]
        try tap(token)
        token.typeText("roost_mobile_" + String(repeating: "a", count: 43))
        try tap(app.buttons["connectButton"])
        let moss = app.buttons["agent-Moss"]
        try ready(moss, timeout: 15)
        let agents = XCTAttachment(screenshot: app.screenshot())
        agents.name = "Agents"
        agents.lifetime = .keepAlways
        add(agents)
        try openMoss(app)
        try exists(app.staticTexts["The garden is ready for a fresh start."], timeout: 15)
        try require(!app.staticTexts["You"].exists, "Messages format should omit speaker labels")
        try require(
            !app.descendants(matching: .any)["toolActivity"].exists,
            "Messages format should hide tool activity")
        try require(
            !app.descendants(matching: .any)["typingIndicator"].exists,
            "Idle conversation should not show typing")
        try require(
            app.staticTexts["How is the balcony garden looking?"].frame.minX
                > app.staticTexts["The garden is ready for a fresh start."].frame.minX,
            "User messages should align to the right of assistant messages")
        let conversation = XCTAttachment(screenshot: app.screenshot())
        conversation.name = "Conversation"
        conversation.lifetime = .keepAlways
        add(conversation)
        let composer = app.textFields["messageComposer"]
        try tap(composer)
        composer.typeText("Let's plan the week")
        try tap(app.buttons["sendMessage"])
        try exists(app.staticTexts["Let's plan the week"])
        try await verifyOneMessage("Let's plan the week", in: app)
        let approve = app.buttons["approveOnce"]
        if !approve.isHittable { app.swipeUp() }
        try tap(approve)
        try exists(app.staticTexts["Approved once"])
        try exists(app.descendants(matching: .any)["typingIndicator"].firstMatch)
        try require(
            !app.staticTexts["Moss is working…"].exists,
            "Messages format should use the typing indicator")
        try require(!app.staticTexts["Queued"].exists, "Running turn should not remain queued")
        try require(!app.buttons["Reply"].exists, "Reply should be available by gesture")
        let userMessage = app.staticTexts["Let's plan the week"]
        userMessage.swipeRight()
        try require(
            !app.staticTexts["Continue in this thread"].exists,
            "User-message swipe must not open a reply thread")
        let assistantMessage = app.staticTexts["The garden is ready for a fresh start."]
        if !assistantMessage.isHittable { app.swipeDown() }
        assistantMessage.swipeRight()
        try exists(app.staticTexts["Continue in this thread"])
        let threadComposer = app.textFields["messageComposer"]
        try tap(threadComposer)
        threadComposer.typeText("Focus on the balcony")
        try tap(app.buttons["sendMessage"])
        try exists(app.staticTexts["Focus on the balcony"])
        let reply = XCTAttachment(screenshot: app.screenshot())
        reply.name = "Reply thread"
        reply.lifetime = .keepAlways
        add(reply)
        app.terminate()
        app.launchArguments = ["-appearance", "dark"]
        app.launch()
        try ready(app.buttons["agent-Moss"])
        try openMoss(app)
        try exists(app.staticTexts["Let's plan the week"])
        let dark = XCTAttachment(screenshot: app.screenshot())
        dark.name = "Conversation dark"
        dark.lifetime = .keepAlways
        add(dark)
        try tap(app.navigationBars.buttons["Roost"])
        try tap(app.buttons["Settings"])
        try tap(app.buttons["responseStylePicker"], scrollable: true)
        try tap(app.buttons["Codex"])
        try tap(app.navigationBars["Settings"].buttons["Done"])
        try openMoss(app)
        try exists(app.staticTexts["You"].firstMatch)
        try require(
            app.descendants(matching: .any)["toolActivity"].firstMatch.exists,
            "Codex format should show tool activity")

        // Remove launch-only appearance overrides before testing saved settings.
        app.terminate()
        app.launchArguments = []
        app.launch()
        try ready(app.buttons["agent-Moss"])
        try tap(app.buttons["Settings"])
        try tap(app.buttons["colorThemePicker"], scrollable: true)
        for theme in ["default", "rose-pine", "carbonfox", "catppuccin"] {
            try tap(app.buttons["theme-" + theme], scrollable: true)
            try require(
                app.buttons["theme-" + theme].isSelected, "Selected theme did not update: " + theme)
            for mode in ["Light", "Dark"] {
                try tap(app.segmentedControls["themeAppearance"].buttons[mode], scrollable: true)
                let screenshot = XCTAttachment(screenshot: app.screenshot())
                screenshot.name = "Theme \(theme) \(mode)"
                screenshot.lifetime = .keepAlways
                add(screenshot)
            }
        }
        try tap(app.navigationBars["Theme"].buttons["Settings"])
        try tap(app.buttons["responseStylePicker"], scrollable: true)
        try tap(app.buttons["Messages"])
        try tap(app.navigationBars["Settings"].buttons["Done"])
        try openMoss(app)
        try exists(app.staticTexts["Let's plan the week"])
        let themedConversation = XCTAttachment(screenshot: app.screenshot())
        themedConversation.name = "Catppuccin conversation"
        themedConversation.lifetime = .keepAlways
        add(themedConversation)

        app.terminate()
        app.launch()
        try ready(app.buttons["agent-Moss"])
        try tap(app.buttons["Settings"])
        try tap(app.buttons["colorThemePicker"], scrollable: true)
        try require(
            app.buttons["theme-catppuccin"].isSelected, "Theme must persist across relaunch")
        try require(
            app.segmentedControls["themeAppearance"].buttons["Dark"].isSelected,
            "Appearance must persist across relaunch")

        try tap(app.navigationBars["Theme"].buttons["Settings"])
        try tap(app.navigationBars["Settings"].buttons["Done"])
        try openMoss(app)
        var interrupted = URLRequest(
            url: URL(string: "http://127.0.0.1:4399/__fixture/lose-next-send-response")!)
        interrupted.httpMethod = "POST"
        interrupted.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, interruptedResponse) = try await URLSession.shared.data(for: interrupted)
        try require(
            (interruptedResponse as? HTTPURLResponse)?.statusCode == 204,
            "Lost-response fixture setup failed")
        let retryText = "Keep this message exactly once, even if delivery is interrupted."
        try tap(app.textFields["messageComposer"])
        app.textFields["messageComposer"].typeText(retryText)
        try tap(app.buttons["sendMessage"])
        try exists(app.staticTexts[retryText])
        app.terminate()
        app.launch()
        try ready(app.buttons["agent-Moss"])
        try openMoss(app)
        try exists(app.staticTexts[retryText])
        // The persisted UUID is reconciled with the authoritative receipt, even
        // when the POST response was lost. The composer recovers without a retry.
        let recoveredComposer = app.textFields["messageComposer"]
        try ready(recoveredComposer)
        try await verifyOneMessage(retryText, in: app)
        try require(
            !app.staticTexts["Delivery is unconfirmed. Retry safely with the same message."].exists,
            "Server receipt should clear the uncertain delivery state")

        app.terminate()
        app.launchArguments = ["-ui-testing-reduce-motion"]
        app.launch()
        try ready(app.buttons["agent-Moss"])
        try openMoss(app)
        let multiline = "A calmer send.\nWith room for another line."
        try tap(app.textFields["messageComposer"])
        app.textFields["messageComposer"].typeText(multiline)
        try tap(app.buttons["sendMessage"])
        try exists(app.staticTexts[multiline])
        try await verifyOneMessage(multiline, in: app)
        try require(app.keyboards.firstMatch.exists, "Sending should retain keyboard focus")
        let reduced = XCTAttachment(screenshot: app.screenshot())
        reduced.name = "Reduced motion multiline send"
        reduced.lifetime = .keepAlways
        add(reduced)
    }
}
