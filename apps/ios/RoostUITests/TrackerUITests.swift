import XCTest

final class TrackerUITests: XCTestCase {
    @MainActor func testCreateEditTrackersAndUseCodingHandoffs() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        var reset = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/reset")!)
        reset.httpMethod = "POST"
        reset.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (_, response) = try await URLSession.shared.data(for: reset)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 204)
        app.launchArguments = ["-ui-testing-reset", "-ui-testing-reduce-motion"]
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
        app.buttons["workspace-dashboard"].tap()
        XCTAssertTrue(app.buttons["Add tracker"].waitForExistence(timeout: 10))
        app.buttons["Add tracker"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .tap()
        app.buttons["To-do list"].tap()
        guard app.buttons["Create tracker"].waitForExistence(timeout: 5) else {
            throw NSError(domain: "TrackerSheetDidNotOpen", code: 1)
        }
        app.buttons["Create tracker"].tap()
        let todo = app.textFields["todo-input-items"]
        guard todo.waitForExistence(timeout: 10) else {
            throw NSError(domain: "TrackerDidNotAppear", code: 1)
        }
        todo.tap()
        todo.typeText("Water the basil")
        app.buttons["Add task"].tap()
        XCTAssertTrue(app.buttons["Mark Water the basil complete"].waitForExistence(timeout: 10))
        app.buttons["Mark Water the basil complete"].tap()
        XCTAssertTrue(app.buttons["Mark Water the basil incomplete"].waitForExistence(timeout: 10))
        capture(app, "Native editable to-do tracker")

        // Mutate the authoritative revision while text is entered to exercise conflict recovery.
        let agents = try await request("agents") as! [[String: Any]]
        let moss = agents.first { $0["name"] as? String == "Moss" }!["id"] as! String
        let dashboard = try await request("agents/\(moss)/dashboard") as! [String: Any]
        let widget = (dashboard["widgets"] as! [[String: Any]])
            .first { $0["title"] as? String == "To-do list" }!
        todo.tap()
        todo.typeText("Buy soil")
        _ = try await request(
            "agents/\(moss)/dashboard/action",
            body: [
                "key": widget["key"]!, "expectedRevision": widget["revision"]!, "blockId": "items",
                "action": "add-todo", "id": UUID().uuidString, "label": "Trim mint",
            ])
        app.buttons["Add task"].tap()
        XCTAssertTrue(
            app.staticTexts[
                "This tracker changed. Your draft is kept; review the latest entries and try again."
            ]
            .waitForExistence(timeout: 10))
        XCTAssertEqual(todo.value as? String, "Buy soil")
        app.buttons["Add task"].tap()
        XCTAssertTrue(app.buttons["Mark Buy soil complete"].waitForExistence(timeout: 10))
        app.buttons["Delete Buy soil"].tap()
        let deleted = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: app.buttons["Mark Buy soil complete"])
        let deletedResult = await XCTWaiter.fulfillment(of: [deleted], timeout: 10)
        XCTAssertEqual(deletedResult, .completed)

        app.buttons["Add tracker"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            .tap()
        app.buttons["Calorie log"].tap()
        app.buttons["Create tracker"].tap()
        let meal = app.textFields["meal-input-items"]
        XCTAssertTrue(meal.waitForExistence(timeout: 10))
        meal.tap()
        meal.typeText("Lunch")
        app.textFields["calories-input-items"].tap()
        app.textFields["calories-input-items"].typeText("520")
        app.buttons["Add meal"].tap()
        XCTAssertTrue(app.staticTexts["520 kcal"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.datePickers["calorie-day-items"].exists)
        let total = app.staticTexts["calorie-total-items"]
        XCTAssertTrue(total.label.contains("520"))
        capture(app, "Native daily calorie log")
        let saved = try await request("agents/\(moss)/dashboard") as! [String: Any]
        let log = (saved["widgets"] as! [[String: Any]])
            .first { $0["title"] as? String == "Calorie log" }!
        let entries = (log["blocks"] as! [[String: Any]])[0]["entries"] as! [[String: Any]]
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["calories"] as? Int, 520)
        app.buttons["Delete Lunch"].tap()
        XCTAssertTrue(app.staticTexts["No entries for this day."].waitForExistence(timeout: 10))

        app.navigationBars.buttons["Roost"].tap()
        app.buttons["agent-Wisp"].tap()
        app.buttons["workspace-coding"].tap()
        XCTAssertTrue(app.buttons["job-A calmer garden dashboard"].waitForExistence(timeout: 10))
        app.buttons["job-A calmer garden dashboard"].tap()
        let handoff = app.segmentedControls["coding-handoff-picker"]
        XCTAssertTrue(handoff.waitForExistence(timeout: 10))
        handoff.buttons["Review"].tap()
        XCTAssertTrue(app.staticTexts["Latest changes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Verification"].exists)
        capture(app, "Native coding review handoff")
        handoff.buttons["Try it"].tap()
        XCTAssertTrue(
            app.staticTexts["No preview has been shared yet. You can still leave feedback below."]
                .exists)
        capture(app, "Native coding preview handoff")
        app.terminate()
        app.launchArguments = ["-ui-testing-reduce-motion"]
        app.launch()
        XCTAssertTrue(app.buttons["agent-Wisp"].waitForExistence(timeout: 10))
        app.buttons["agent-Wisp"].tap()
        app.buttons["workspace-coding"].tap()
        XCTAssertTrue(app.buttons["job-A calmer garden dashboard"].waitForExistence(timeout: 10))
        app.buttons["job-A calmer garden dashboard"].tap()
        XCTAssertTrue(handoff.waitForExistence(timeout: 10))
        XCTAssertTrue(
            handoff.buttons["Try it"].isSelected, "Manual handoff choice survives app restart")
        handoff.buttons["Overview"].tap()
        XCTAssertTrue(app.buttons["open-worker"].exists)
    }

    private func request(_ path: String, body: [String: Any]? = nil) async throws -> Any {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/" + path)!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertTrue((200...299).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
        return try JSONSerialization.jsonObject(with: data)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
