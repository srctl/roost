import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor func testSharedNotesDashboardAndCoding() async throws {
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
        app.buttons["agent-Moss"].tap()
        XCTAssertTrue(app.buttons["workspace-dashboard"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["workspace-coding"].exists)
        app.buttons["workspace-dashboard"].tap()
        XCTAssertTrue(app.staticTexts["A little greener every week"].waitForExistence(timeout: 10))
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
        app.buttons["workspace-notes"].tap()
        let editor = app.textViews["noteTextEditor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        capture(app, "Shared notes")
        // A tap in the empty canvas adds a paragraph and puts the caret there.
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.88)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(
            app.buttons["workspace-notes"].exists, "Navigation yields space to the keyboard")
        editor.typeText("## Garden ideas\n")
        app.buttons["Bold"].tap()
        editor.typeText("Bring the rosemary ")
        try await Task.sleep(for: .milliseconds(1400))
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Autosave must keep the editor ready")
        editor.typeText("inside on cold nights.")
        app.buttons["Bold"].tap()
        editor.typeText("\n[] Water the thyme")
        let beforeUndo = editor.value as? String
        editor.typeText("!")
        app.buttons["Undo"].tap()
        XCTAssertEqual(editor.value as? String, beforeUndo)
        app.buttons["Redo"].tap()
        XCTAssertEqual(editor.value as? String, (beforeUndo ?? "") + "!")
        app.buttons["Undo"].tap()
        capture(app, "Native note editor")
        app.buttons["Done editing"].tap()
        XCTAssertTrue(app.buttons["workspace-notes"].waitForExistence(timeout: 5))
        XCTAssertFalse((editor.value as? String ?? "").contains("## "))
        XCTAssertFalse((editor.value as? String ?? "").contains("[] "))
        // Read the actual shared store through the authenticated API.
        let agents = try await get("agents") as! [[String: Any]]
        let moss = agents.first { $0["name"] as? String == "Moss" }!["id"] as! String
        var saved = false
        for _ in 0..<20 {
            let note = try await get("agents/\(moss)/note") as! [String: Any]
            let blocks = note["blocks"] as! [[String: Any]]
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
        XCTAssertTrue(saved)
        app.navigationBars["Moss’s notes"].buttons["Note options"]
            .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        app.buttons["History"].tap()
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Revision '")).firstMatch
                .waitForExistence(timeout: 10))
        capture(app, "Note history")
        app.navigationBars["Note history"].buttons["Done"].tap()
        app.navigationBars.buttons["Roost"].tap()
        app.buttons["agent-Wisp"].tap()
        app.buttons["workspace-coding"].tap()
        XCTAssertTrue(app.buttons["job-A calmer garden dashboard"].waitForExistence(timeout: 10))
        capture(app, "Coding jobs")
        app.buttons["job-A calmer garden dashboard"].tap()
        XCTAssertTrue(app.staticTexts["Latest changes"].waitForExistence(timeout: 10))
        capture(app, "Coding workspace")
        app.buttons["open-worker"].tap()
        let composer = app.textFields["workerComposer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 10))
        composer.tap()
        composer.typeText("Please give the charts a little more space.")
        app.buttons["Send to worker"].tap()
        XCTAssertTrue(
            app.staticTexts["Please give the charts a little more space."]
                .waitForExistence(timeout: 10))
        XCTAssertTrue(
            app.keyboards.firstMatch.exists, "Sending must keep the worker composer ready")
        capture(app, "Worker conversation")
        app.terminate()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(app.buttons["agent-Moss"].waitForExistence(timeout: 10))
        app.buttons["agent-Moss"].tap()
        app.buttons["workspace-notes"].tap()
        XCTAssertTrue(app.textViews["noteTextEditor"].waitForExistence(timeout: 10))
        XCTAssertTrue(
            (app.textViews["noteTextEditor"].value as? String ?? "")
                .contains("Bring the rosemary inside on cold nights."))
    }

    private func get(_ path: String) async throws -> Any {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/" + path)!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONSerialization.jsonObject(with: data)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
