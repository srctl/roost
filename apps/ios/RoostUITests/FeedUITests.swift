import XCTest

final class FeedUITests: XCTestCase {
    @MainActor func testSharedFeedReaderPreferencesAndDiscussion() async throws {
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
        app.tabBars.buttons["Feed"].tap()

        let articleID = "8015a702-9046-4513-8567-a3daf8b33333"
        let article = app.buttons["feed-item-" + articleID]
        XCTAssertTrue(article.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Capitol Hill Seattle Blog"].exists)
        capture(app, "Shared native feed")
        article.tap()
        XCTAssertTrue(app.navigationBars["Story"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["A greener walk through Capitol Hill"].exists)
        app.buttons["Save for later"].tap()
        XCTAssertTrue(app.buttons["Remove from saved"].waitForExistence(timeout: 5))
        capture(app, "Native feed reader")
        let afterRead = try await feed()
        let savedArticle = try XCTUnwrap(
            (afterRead["items"] as? [[String: Any]])?.first { $0["id"] as? String == articleID })
        XCTAssertEqual(savedArticle["saved"] as? Bool, true)
        XCTAssertNotNil(savedArticle["readAt"] as? Double)

        app.navigationBars["Story"].buttons.firstMatch.tap()
        app.segmentedControls["feedFilter"].buttons["Saved"].tap()
        XCTAssertTrue(article.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Your dinner reservation moved to 7:30"].exists)
        app.segmentedControls["feedFilter"].buttons["Unread"].tap()
        XCTAssertTrue(
            app.staticTexts["Your dinner reservation moved to 7:30"].waitForExistence(timeout: 5))
        XCTAssertFalse(article.exists)

        app.buttons["Feed preferences"].tap()
        let interests = app.textFields["feedInterests"]
        XCTAssertTrue(interests.waitForExistence(timeout: 5))
        capture(app, "Native feed preferences")
        interests.tap()
        interests.typeText(" More local art.")
        app.buttons["feedSavePreferences"].tap()
        XCTAssertTrue(app.navigationBars["Feed"].waitForExistence(timeout: 5))
        let updated = try await feed()
        XCTAssertTrue(
            ((updated["settings"] as? [String: Any])?["interests"] as? String ?? "")
                .contains("More local art."))

        app.segmentedControls["feedFilter"].buttons["All"].tap()
        XCTAssertTrue(article.waitForExistence(timeout: 5))
        article.swipeLeft()
        app.buttons["Dismiss"].tap()
        XCTAssertTrue(app.buttons["Restore"].waitForExistence(timeout: 5))
        XCTAssertFalse(article.exists)
        app.buttons["Restore"].tap()
        XCTAssertTrue(article.waitForExistence(timeout: 5))
        article.tap()
        app.swipeUp()
        let discuss = app.buttons["feedDiscuss"]
        XCTAssertTrue(discuss.waitForExistence(timeout: 5))
        discuss.tap()
        XCTAssertTrue(app.textFields["messageComposer"].waitForExistence(timeout: 10))
        capture(app, "Feed discussion")
    }

    private func feed() async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/feed")!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
