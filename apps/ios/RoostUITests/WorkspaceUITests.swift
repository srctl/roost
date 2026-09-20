import XCTest

final class WorkspaceUITests: XCTestCase {
    private enum Failure: Error { case expectation(String) }

    @MainActor private func stopAfterRecordedFailure() throws {
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
        guard element.waitForExistence(timeout: timeout) else {
            throw Failure.expectation("Missing element: " + element.description)
        }
        try stopAfterRecordedFailure()
    }

    @MainActor private func tap(_ element: XCUIElement, scrollable: Bool = false) throws {
        try exists(element)
        let field =
            [.textField, .secureTextField, .textView].contains(element.elementType)
            || element.identifier == "connectButton"
        let predicate = NSPredicate(
            format: field || scrollable
                ? "exists == true AND enabled == true"
                : "exists == true AND hittable == true AND enabled == true")
        let ready = XCTNSPredicateExpectation(predicate: predicate, object: element)
        guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
            throw Failure.expectation("Control is not ready: " + element.description)
        }
        if field || scrollable {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        try stopAfterRecordedFailure()
    }

    @MainActor private func type(_ text: String, into element: XCUIElement) throws {
        try exists(element)
        element.typeText(text)
        try stopAfterRecordedFailure()
    }

    @MainActor private func selectTab(_ name: String, in app: XCUIApplication) throws {
        let tab = app.buttons["workspace-" + name]
        try tap(tab)
        let selected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "selected == true"), object: tab)
        guard XCTWaiter.wait(for: [selected], timeout: 10) == .completed else {
            throw Failure.expectation("Workspace tab did not select: " + name)
        }
        try stopAfterRecordedFailure()
    }

    @MainActor func testSharedNotesDashboardAndCoding() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, response) = try await URLSession.shared.data(for: reset)
        try require((response as? HTTPURLResponse)?.statusCode == 204, "Fixture reset failed")
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        let server = app.textFields["serverAddress"]
        try exists(server)
        try tap(server)
        try type("http://127.0.0.1:4399", into: server)
        try tap(app.secureTextFields["deviceToken"])
        try type(
            "roost_mobile_" + String(repeating: "a", count: 43),
            into: app.secureTextFields["deviceToken"])
        try tap(app.buttons["connectButton"])
        try exists(app.buttons["agent-Moss"], timeout: 15)
        try tap(app.buttons["agent-Moss"])
        try exists(app.navigationBars["Moss"])
        try exists(app.buttons["workspace-dashboard"], timeout: 10)
        try require(!app.buttons["workspace-coding"].exists, "A general agent must not show Coding")
        try selectTab("dashboard", in: app)
        try exists(app.staticTexts["A little greener every week"], timeout: 10)
        capture(app, "Native dashboard")
        let viewPicker = app.buttons["dashboard-view-picker"]
        XCTAssertTrue(viewPicker.waitForExistence(timeout: 10))
        viewPicker.tap()
        for option in ["Everything", "Summary", "Charts", "Tables", "Tasks"] {
            XCTAssertTrue(app.buttons[option].exists)
        }
        app.buttons["Charts"].tap()
        let chartsSelected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == 'Charts'"), object: viewPicker)
        let chartsResult = await XCTWaiter.fulfillment(of: [chartsSelected], timeout: 10)
        XCTAssertEqual(chartsResult, .completed)
        XCTAssertTrue(app.staticTexts["Growing together"].exists)
        XCTAssertFalse(app.staticTexts["Happy plants"].exists)
        XCTAssertFalse(app.staticTexts["Data sources"].exists)
        XCTAssertFalse(app.staticTexts["Rotate the basil toward the sun, todo"].exists)
        capture(app, "Native Juxi charts view")
        app.buttons["View values"].tap()
        XCTAssertTrue(app.staticTexts["Series: Basil"].firstMatch.waitForExistence(timeout: 5))
        viewPicker.tap()
        app.buttons["Tables"].tap()
        XCTAssertTrue(app.staticTexts["Data sources"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Growing together"].exists)
        app.staticTexts["Balcony herb growth"].tap()
        XCTAssertTrue(app.staticTexts["Basil: 16"].waitForExistence(timeout: 5))
        capture(app, "Native Juxi tables view")
        app.buttons["Reset dashboard view"].tap()
        XCTAssertTrue(app.staticTexts["Happy plants"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Reset dashboard view"].exists)
        try selectTab("notes", in: app)
        let editor = app.textViews["noteTextEditor"]
        try exists(editor, timeout: 10)
        capture(app, "Shared notes")
        // A tap in the empty canvas adds a paragraph and puts the caret there.
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.88)).tap()
        try stopAfterRecordedFailure()
        try exists(app.keyboards.firstMatch, timeout: 5)
        try require(
            !app.buttons["workspace-notes"].exists, "Navigation yields space to the keyboard")
        try type("## Garden ideas\n", into: editor)
        try tap(app.buttons["Bold"])
        try type("Bring the rosemary ", into: editor)
        try await Task.sleep(for: .milliseconds(1400))
        try require(app.keyboards.firstMatch.exists, "Autosave must keep the editor ready")
        try type("inside on cold nights.", into: editor)
        try tap(app.buttons["Bold"])
        try type("\n[] Water the thyme", into: editor)
        let beforeUndo = editor.value as? String
        try type("!", into: editor)
        try tap(app.buttons["Undo"])
        try require(editor.value as? String == beforeUndo, "Undo must restore the note")
        try tap(app.buttons["Redo"])
        try require(
            editor.value as? String == (beforeUndo ?? "") + "!", "Redo must restore the insertion")
        try tap(app.buttons["Undo"])
        capture(app, "Native note editor")
        try tap(app.buttons["Done editing"])
        try exists(app.buttons["workspace-notes"], timeout: 5)
        try require(
            !(editor.value as? String ?? "").contains("## "),
            "Heading shortcut must become a heading")
        try require(
            !(editor.value as? String ?? "").contains("[] "), "Todo shortcut must become a todo")
        // Read the actual shared store through the authenticated API.
        let agentsResponse = try await get("agents")
        let agents = try XCTUnwrap(agentsResponse as? [[String: Any]])
        let moss = try XCTUnwrap(agents.first { $0["name"] as? String == "Moss" }?["id"] as? String)
        var saved = false
        for _ in 0..<20 {
            let noteResponse = try await get("agents/\(moss)/note")
            let note = try XCTUnwrap(noteResponse as? [String: Any])
            let blocks = try XCTUnwrap(note["blocks"] as? [[String: Any]])
            let heading = blocks.contains {
                ($0["type"] as? String) == "heading" && ($0["level"] as? Int) == 2
                    && (($0["content"] as? [[String: Any]])?.first?["text"] as? String)
                        == "Garden ideas"
            }
            let todo = blocks.contains {
                ($0["type"] as? String) == "todo"
                    && (($0["content"] as? [[String: Any]])?.first?["text"] as? String)
                        == "Water the thyme"
            }
            saved =
                heading && todo
                && blocks.contains { block in
                    let spans = block["content"] as? [[String: Any]] ?? []
                    return spans.compactMap { $0["text"] as? String }.joined()
                        == "Bring the rosemary inside on cold nights."
                        && spans.contains { $0["bold"] as? Bool == true }
                }
            if saved { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        try require(saved, "Shared note must persist heading, bold paragraph, and todo blocks")
        let noteOptions = app.navigationBars["Moss’s notes"].buttons["Note options"]
        try exists(noteOptions)
        // SwiftUI Menu exposes an outer AX button around its real UIKit button.
        // That wrapper reports non-hittable even while its visible center opens
        // the menu. Verify its screen bounds, then verify the actual menu action.
        let menuFrame = noteOptions.frame
        try require(
            menuFrame.width > 0 && menuFrame.height > 0
                && app.frame.contains(CGPoint(x: menuFrame.midX, y: menuFrame.midY)),
            "Note options must be visible before opening its menu")
        noteOptions.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        try stopAfterRecordedFailure()
        try tap(app.buttons["History"])
        try exists(
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Revision '")).firstMatch)
        capture(app, "Note history")
        try tap(app.navigationBars["Note history"].buttons["Done"])
        try tap(app.navigationBars.buttons["Roost"])
        try tap(app.buttons["agent-Wisp"])
        try exists(app.navigationBars["Wisp"])
        try exists(app.textFields["messageComposer"])
        try selectTab("coding", in: app)
        try exists(app.buttons["job-A calmer garden dashboard"], timeout: 10)
        capture(app, "Coding jobs")
        try tap(app.buttons["job-A calmer garden dashboard"])
        try exists(app.staticTexts["Latest changes"], timeout: 10)
        capture(app, "Coding workspace")
        try tap(app.buttons["open-worker"], scrollable: true)
        let composer = app.textFields["workerComposer"]
        try exists(composer, timeout: 10)
        try tap(composer)
        try type("Please give the charts a little more space.", into: composer)
        try tap(app.buttons["Send to worker"])
        try exists(app.staticTexts["Please give the charts a little more space."])
        try require(
            app.keyboards.firstMatch.exists, "Sending must keep the worker composer ready")
        capture(app, "Worker conversation")
        app.terminate()
        app.launchArguments = []
        app.launch()
        try exists(app.buttons["agent-Moss"], timeout: 10)
        try tap(app.buttons["agent-Moss"])
        try exists(app.navigationBars["Moss"])
        try selectTab("notes", in: app)
        try exists(app.textViews["noteTextEditor"], timeout: 10)
        try require(
            (app.textViews["noteTextEditor"].value as? String ?? "")
                .contains("Bring the rosemary inside on cold nights."),
            "Saved note must survive relaunch")
    }

    private func get(_ path: String) async throws -> Any {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/" + path)!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Failure.expectation("API read failed: " + path)
        }
        return try JSONSerialization.jsonObject(with: data)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
