import UIKit
import XCTest

final class FeedUITests: XCTestCase {
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
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(
                format: field || scrollable
                    ? "exists == true AND enabled == true"
                    : "exists == true AND hittable == true AND enabled == true"), object: element)
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

    @MainActor private func decodedImage(_ id: String, in app: XCUIApplication) throws
        -> XCUIElement
    {
        let image = app.descendants(matching: .any)[id].firstMatch
        let decoded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == true AND value == %@", "Image preview"),
            object: image)
        guard XCTWaiter.wait(for: [decoded], timeout: 15) == .completed else {
            capture(app, "Feed image did not decode")
            throw Failure.expectation("Feed photo must decode from the local image fixture: " + id)
        }
        try stopAfterRecordedFailure()
        return image
    }

    @MainActor private func requireBoundedImage(_ image: XCUIElement, in app: XCUIApplication)
        throws
    {
        let frame = image.frame
        try require(
            frame.width > 80 && frame.height > 40, "Decoded image must have visible dimensions")
        try require(frame.width > frame.height, "Feed images must use a landscape presentation")
        try require(
            frame.width <= app.frame.width + 1, "Feed image must fit the available screen width")
        try require(frame.width <= 421, "Feed image must remain at most 420 points wide")
        try require(frame.height <= 301, "Feed image must remain at most 300 points tall")
    }

    @MainActor private func rotate(_ orientation: UIDeviceOrientation, app: XCUIApplication) throws
    {
        XCUIDevice.shared.orientation = orientation
        let landscape = orientation.isLandscape
        var previousFrame: CGRect?
        var previousScreen: CGSize?
        var stableSince: Date?
        let settled = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                let frame = app.frame
                let screen = XCUIScreen.main.screenshot().image.size
                guard landscape ? frame.width > frame.height : frame.height > frame.width,
                    landscape ? screen.width > screen.height : screen.height > screen.width
                else {
                    stableSince = nil
                    return false
                }
                if previousFrame != frame || previousScreen != screen || stableSince == nil {
                    previousFrame = frame
                    previousScreen = screen
                    stableSince = Date()
                    return false
                }
                return Date().timeIntervalSince(stableSince!) >= 0.4
            }, object: app)
        guard XCTWaiter.wait(for: [settled], timeout: 10) == .completed else {
            throw Failure.expectation("Feed reader must support device rotation")
        }
        try stopAfterRecordedFailure()
    }

    @MainActor func testSharedFeedReaderPreferencesAndDiscussion() async throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
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
        try tap(server)
        try type("http://127.0.0.1:4399", into: server)
        try tap(app.secureTextFields["deviceToken"])
        try type(
            "roost_mobile_" + String(repeating: "a", count: 43),
            into: app.secureTextFields["deviceToken"])
        try tap(app.buttons["connectButton"])
        try exists(app.buttons["agent-Moss"], timeout: 15)
        try tap(app.tabBars.buttons["Feed"])

        let articleID = "8015a702-9046-4513-8567-a3daf8b33333"
        let article = app.buttons["feed-item-" + articleID]
        try exists(article)
        try require(
            app.staticTexts["Capitol Hill Seattle Blog"].exists, "Article source must be visible")
        try require(
            !app.segmentedControls["feedFilter"].buttons["Unread"].exists,
            "Feed should offer All and Saved without read tracking")
        let rowImage = try decodedImage("feed-row-image-" + articleID, in: app)
        try requireBoundedImage(rowImage, in: app)
        capture(app, "Shared native feed with landscape photo")
        try tap(article)
        try exists(app.navigationBars["Story"])
        try exists(app.staticTexts["A greener walk through Capitol Hill"])
        let readerImage = try decodedImage("feed-reader-image-" + articleID, in: app)
        try requireBoundedImage(readerImage, in: app)
        capture(app, "Native feed reader with decoded photo")
        try rotate(.landscapeLeft, app: app)
        let landscapeImage = try decodedImage("feed-reader-image-" + articleID, in: app)
        for _ in 0..<3 where !landscapeImage.isHittable { app.swipeUp() }
        try requireBoundedImage(landscapeImage, in: app)
        try require(
            landscapeImage.frame.intersects(app.frame),
            "Reader image must remain on screen in landscape")
        capture(app, "Native feed reader bounded landscape image", fullScreen: true)
        try rotate(.portrait, app: app)
        try tap(app.buttons["Save for later"])
        try exists(app.buttons["Remove from saved"])
        let afterRead = try await feed()
        let savedArticle = try XCTUnwrap(
            (afterRead["items"] as? [[String: Any]])?.first { $0["id"] as? String == articleID })
        try require(
            savedArticle["saved"] as? Bool == true, "Saving a story must persist on the server")

        try tap(app.navigationBars["Story"].buttons.firstMatch)
        try tap(app.segmentedControls["feedFilter"].buttons["Saved"])
        try exists(article)
        try require(
            !app.staticTexts["Your dinner reservation moved to 7:30"].exists,
            "Saved filter must hide unsaved items")
        try tap(app.segmentedControls["feedFilter"].buttons["All"])
        try exists(article)
        // Rich summaries and photos can place later cards below the fold.
        let all = try await feed()
        try require(
            (all["items"] as? [[String: Any]])?
                .contains {
                    $0["title"] as? String == "Your dinner reservation moved to 7:30"
                } == true, "All feed data must retain the unsaved reservation update")

        try tap(app.buttons["Feed preferences"])
        let interests = app.textFields["feedInterests"]
        try exists(interests)
        capture(app, "Native feed preferences")
        try tap(interests)
        try type(" More local art.", into: interests)
        try tap(app.buttons["feedSavePreferences"])
        try exists(app.navigationBars["Feed"])
        let updated = try await feed()
        try require(
            ((updated["settings"] as? [String: Any])?["interests"] as? String ?? "")
                .contains("More local art."), "Feed interests must persist on the server")

        try exists(article)
        article.swipeLeft()
        try stopAfterRecordedFailure()
        try tap(app.buttons["Dismiss"])
        try exists(app.buttons["Restore"])
        try require(!article.exists, "Dismissed story must leave the feed")
        let dismissed = try await feed()
        try require(
            (dismissed["items"] as? [[String: Any]])?.contains { $0["id"] as? String == articleID }
                == false, "Dismissed story must leave the server feed")
        try tap(app.buttons["Restore"])
        try exists(app.staticTexts["Restored to your feed."])
        let restored = try await feed()
        try require(
            (restored["items"] as? [[String: Any]])?
                .contains {
                    $0["id"] as? String == articleID && $0["dismissed"] as? Bool == false
                } == true, "Restored story must return to the server feed")
        try exists(article)
        try tap(article)
        let discuss = app.buttons["feedDiscuss"]
        for _ in 0..<4 where !discuss.isHittable { app.swipeUp() }
        try tap(discuss, scrollable: true)
        try exists(app.textFields["messageComposer"])
        capture(app, "Feed discussion")
    }

    private func feed() async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/api/mobile/v1/feed")!)
        request.setValue(
            "Bearer roost_mobile_" + String(repeating: "a", count: 43),
            forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            throw Failure.expectation("Feed API read failed")
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @MainActor private func capture(
        _ app: XCUIApplication, _ name: String, fullScreen: Bool = false
    ) {
        let attachment = XCTAttachment(
            screenshot: fullScreen ? XCUIScreen.main.screenshot() : app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
