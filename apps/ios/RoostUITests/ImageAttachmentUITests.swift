import XCTest

final class ImageAttachmentUITests: XCTestCase {
    private enum Failure: Error { case unavailable }
    private func require(_ condition: Bool, _ message: String = "Expected control is missing")
        throws
    {
        guard condition else {
            XCTFail(message)
            throw Failure.unavailable
        }
    }
    @MainActor func testImagePreviewAndPhotoComposer() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        _ = try await fixture("reset")
        let data = try await fixture("images")
        let fixture = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let image = fixture["image"] as! [String: Any]
        let imageId = image["id"] as! String
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        let server = app.textFields["serverAddress"]
        try require(server.waitForExistence(timeout: 10))
        server.tap()
        server.typeText("http://127.0.0.1:4399")
        app.secureTextFields["deviceToken"].tap()
        app.secureTextFields["deviceToken"]
            .typeText("roost_mobile_" + String(repeating: "a", count: 43))
        app.buttons["connectButton"].tap()
        try require(app.buttons["agent-Moss"].waitForExistence(timeout: 15))
        app.buttons["agent-Moss"].tap()
        let picture = app.buttons["imageAttachment-" + imageId]
        try require(picture.waitForExistence(timeout: 15))
        let decoded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == 'Image preview'"), object: picture)
        try require(
            XCTWaiter.wait(for: [decoded], timeout: 15) == .completed, "Image should finish loading"
        )
        capture(app, "Inline image attachment")
        picture.tap()
        if !app.buttons["Done"].waitForExistence(timeout: 2) { app.tap() }
        try require(app.buttons["Done"].waitForExistence(timeout: 10))
        capture(app, "Full image preview")
        app.buttons["Done"].tap()
        app.buttons["Add attachment"].tap()
        app.buttons["attachPhoto"].tap()
        // Simulator Photos is seeded with the fixture PNG before this suite.
        let photo = app.images
            .matching(NSPredicate(format: "label CONTAINS[c] 'Photo' OR label CONTAINS[c] 'Image'"))
            .firstMatch
        try require(photo.waitForExistence(timeout: 10))
        photo.tap()
        if app.buttons["Add"].exists { app.buttons["Add"].tap() }
        let thumbnail = app.buttons
            .matching(NSPredicate(format: "identifier BEGINSWITH 'attachmentThumbnail-'"))
            .firstMatch
        try require(thumbnail.waitForExistence(timeout: 15))
        let uploadedId = thumbnail.identifier.replacingOccurrences(
            of: "attachmentThumbnail-", with: "")
        capture(app, "Photo attached before sending")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.buttons["imageAttachment-" + uploadedId].waitForExistence(timeout: 15))
        XCTAssertFalse(thumbnail.exists)
        capture(app, "Sent photo in conversation")
    }

    private func fixture(_ path: String) async throws -> Data {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:4399/__fixture/" + path)!)
        request.httpMethod = "POST"
        request.setValue("reset", forHTTPHeaderField: "X-Roost-Test")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertTrue([200, 204].contains((response as? HTTPURLResponse)?.statusCode ?? 0))
        return data
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }
}
