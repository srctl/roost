import XCTest

final class ChatTrackerUITests: XCTestCase {
    @MainActor func testInlineTrackersShareDashboardDataPreserveDraftsAndWorkInReplies()
        async throws
    {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        _ = try await request("__fixture/reset", body: [:], fixture: true)
        let first = try await show("chat-tasks", kind: "todo", title: "Chat tasks")
        let agent = first["agentId"] as! String
        let firstID = first["id"] as! String
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
        let firstInput = app.textFields["todo-input-items-\(agent)-\(firstID)"]
        guard firstInput.waitForExistence(timeout: 10) else {
            throw NSError(domain: "InlineTodoNotFound", code: 1)
        }
        firstInput.tap()
        firstInput.typeText("Water basil")
        app.buttons["Add task"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Mark Water basil complete"].waitForExistence(timeout: 10))
        app.buttons["Mark Water basil complete"].tap()
        XCTAssertTrue(app.buttons["Mark Water basil incomplete"].waitForExistence(timeout: 10))
        capture(app, "Native chat to-do card")
        firstInput.tap()
        firstInput.typeText("Keep this draft")
        let composer = app.textFields["messageComposer"]
        composer.tap()
        composer.typeText("Ask about the garden")
        app.navigationBars.buttons["Roost"].tap()
        app.buttons["Settings"].tap()
        app.buttons["responseStylePicker"].tap()
        app.buttons["Codex"].tap()
        app.navigationBars["Settings"].buttons["Done"]
            .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let repeated = try await show("chat-tasks", kind: "todo", title: "Chat tasks")
        let repeatedID = repeated["id"] as! String
        app.buttons["agent-Moss"].tap()
        let repeatedInput = app.textFields["todo-input-items-\(agent)-\(repeatedID)"]
        XCTAssertTrue(repeatedInput.waitForExistence(timeout: 10))
        XCTAssertEqual(repeatedInput.value as? String, "Keep this draft")
        XCTAssertEqual(composer.value as? String, "Ask about the garden")
        XCTAssertFalse(
            app.staticTexts["Your \"Chat tasks\" tracker is available in Dashboard."].exists)
        capture(app, "Native Codex style repeated tracker")

        let calories = try await show("chat-calories", kind: "calories", title: "Chat calories")
        let calorieID = calories["id"] as! String
        let meal = app.textFields["meal-input-items-\(agent)-\(calorieID)"]
        guard meal.waitForExistence(timeout: 12) else {
            throw NSError(domain: "InlineMealNotFound", code: 1)
        }
        app.scrollViews.firstMatch.swipeUp()
        meal.tap()
        guard app.keyboards.firstMatch.waitForExistence(timeout: 5) else {
            throw NSError(domain: "MealNotFocused", code: 1)
        }
        meal.typeText("Lunch")
        let caloriesInput = app.textFields["calories-input-items-\(agent)-\(calorieID)"]
        caloriesInput.tap()
        caloriesInput.typeText("520")
        app.buttons["Add meal"].tap()
        guard app.staticTexts["520 kcal"].waitForExistence(timeout: 10) else {
            throw NSError(domain: "MealNotSaved", code: 1)
        }
        capture(app, "Native chat calorie card")
        XCTAssertEqual(composer.value as? String, "Ask about the garden")
        app.buttons["workspace-dashboard"].tap()
        XCTAssertTrue(app.staticTexts["Chat calories"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["520 kcal"].exists)
        let dashboard = try await api("agents/\(agent)/dashboard") as! [String: Any]
        let widgets = dashboard["widgets"] as! [[String: Any]]
        let tasks = widgets.first { $0["key"] as? String == "chat-tasks" }!
        let items = (tasks["blocks"] as! [[String: Any]])[0]["items"] as! [[String: Any]]
        XCTAssertEqual(items.first?["done"] as? Bool, true)
        app.buttons["workspace-chat"].tap()
        let replyButton = app.buttons["reply-card-\(agent)-\(calorieID)"]
        XCTAssertTrue(replyButton.waitForExistence(timeout: 10))
        replyButton.tap()
        guard app.staticTexts["Replying to"].waitForExistence(timeout: 10) else {
            throw NSError(domain: "ReplyNotOpened", code: 1)
        }
        let snapshot = try await api("agents/\(agent)/conversation") as! [String: Any]
        let threads = snapshot["threads"] as! [[String: Any]]
        let thread =
            threads.first { $0["parentMessageId"] as? String == calorieID }!["id"] as! String
        let reply = try await show(
            "chat-tasks", kind: "todo", title: "Chat tasks", conversation: thread)
        let replyID = reply["id"] as! String
        let replyInput = app.textFields["todo-input-items-\(thread)-\(replyID)"]
        XCTAssertTrue(replyInput.waitForExistence(timeout: 12))
        XCTAssertEqual(replyInput.value as? String, "Keep this draft")
        capture(app, "Native reply thread tracker")
        _ = try await request("api/mobile/v1/agents/\(agent)/dashboard", body: ["enabled": false])
        XCTAssertTrue(
            app.staticTexts["Dashboards are disabled."].firstMatch.waitForExistence(timeout: 12))
        XCTAssertFalse(replyInput.exists)
        capture(app, "Native disabled chat tracker")
        _ = try await request("api/mobile/v1/agents/\(agent)/dashboard", body: ["enabled": true])
        XCTAssertTrue(replyInput.waitForExistence(timeout: 12))
        XCTAssertEqual(replyInput.value as? String, "Keep this draft")
        let latest = try await api("agents/\(agent)/conversation") as! [String: Any]
        let entries = latest["entries"] as! [[String: Any]]
        XCTAssertFalse(
            entries.contains {
                ($0["message"] as? [String: Any])?["text"] as? String == "Ask about the garden"
            }, "Editing trackers never sends the chat draft")
    }

    private func show(_ key: String, kind: String, title: String, conversation: String? = nil)
        async throws -> [String: Any]
    {
        var body: [String: Any] = ["key": key, "kind": kind, "title": title]
        if let conversation { body["conversationId"] = conversation }
        return try await request("__fixture/chat-tracker", body: body, fixture: true)
            as! [String: Any]
    }
    private func api(_ path: String) async throws -> Any {
        try await request("api/mobile/v1/" + path)
    }
    private func request(_ path: String, body: [String: Any]? = nil, fixture: Bool = false)
        async throws -> Any
    {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/" + path)!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        if fixture { request.setValue("reset", forHTTPHeaderField: "X-Roost-Test") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status) else {
            throw NSError(domain: "FixtureHTTP", code: status)
        }
        return data.isEmpty ? [:] : try JSONSerialization.jsonObject(with: data)
    }
    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
