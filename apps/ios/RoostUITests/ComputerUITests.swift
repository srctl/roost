import UIKit
import XCTest

final class ComputerUITests: XCTestCase {
    private enum Failure: Error { case unavailable }
    @MainActor private func tap(_ element: XCUIElement) throws {
        let field =
            element.identifier == "connectButton" || element.elementType == .textField
            || element.elementType == .secureTextField
            || element.elementType == .textView
        let ready = XCTNSPredicateExpectation(
            predicate: NSPredicate(
                format: field ? "exists == true" : "exists == true AND hittable == true"),
            object: element)
        guard XCTWaiter.wait(for: [ready], timeout: 15) == .completed else {
            XCTFail("Control did not become available: \(element)")
            throw Failure.unavailable
        }
        element.tap()
    }

    @MainActor func testLiveDesktopControlAndReconnect() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = ["-ui-testing-reset"]
        app.launch()
        try tap(app.textFields["serverAddress"])
        app.textFields["serverAddress"].typeText("http://127.0.0.1:4499")
        try tap(app.secureTextFields["deviceToken"])
        app.secureTextFields["deviceToken"]
            .typeText("roost_mobile_" + String(repeating: "a", count: 43))
        try tap(app.buttons["connectButton"])
        let agent = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'agent-'"))
            .firstMatch
        try tap(agent)
        try tap(app.buttons["workspace-more"])
        try tap(app.buttons["openComputer"])
        guard app.staticTexts["Live · watching"].waitForExistence(timeout: 20) else {
            XCTFail("The native desktop should complete its RFB connection")
            throw Failure.unavailable
        }
        try waitForFramebuffer(app)
        capture(app, "Native live desktop")
        try tap(app.buttons["desktopControl"])
        guard app.staticTexts["You’re in control"].waitForExistence(timeout: 10) else {
            throw Failure.unavailable
        }
        try tap(app.textFields["Type on the desktop"])
        app.textFields["Type on the desktop"].typeText("Hello from iPhone")
        try tap(app.buttons["Send"])
        capture(app, "Native desktop with keyboard")
        try tap(app.buttons["desktopControl"])
        XCTAssertTrue(app.staticTexts["Live · watching"].waitForExistence(timeout: 10))
        // Backgrounding must release control and reconnect with a fresh ticket.
        try tap(app.buttons["desktopControl"])
        guard app.staticTexts["You’re in control"].waitForExistence(timeout: 10) else {
            throw Failure.unavailable
        }
        XCUIDevice.shared.press(.home)
        guard app.wait(for: .runningBackground, timeout: 10) else { throw Failure.unavailable }
        app.activate()
        XCTAssertTrue(app.staticTexts["Live · watching"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.buttons["desktopControl"].label, "Take control")
        try waitForFramebuffer(app)
        capture(app, "Native desktop after reconnect")
        // A second transition catches renderer reuse and teardown races which
        // can be hidden by the first connection's still-visible framebuffer.
        XCUIDevice.shared.press(.home)
        guard app.wait(for: .runningBackground, timeout: 10) else { throw Failure.unavailable }
        app.activate()
        XCTAssertTrue(app.staticTexts["Live · watching"].waitForExistence(timeout: 20))
        XCTAssertEqual(app.buttons["desktopControl"].label, "Take control")
        try waitForFramebuffer(app)
        capture(app, "Native desktop after second reconnect")
    }

    @MainActor private func waitForFramebuffer(_ app: XCUIApplication) throws {
        let painted = XCTNSPredicateExpectation(
            predicate: NSPredicate { _, _ in
                Self.hasFixtureFramebuffer(app.screenshot())
            }, object: app)
        guard XCTWaiter.wait(for: [painted], timeout: 20) == .completed else {
            capture(app, "Desktop framebuffer did not paint")
            throw Failure.unavailable
        }
    }

    // Inspect rendered screen pixels, not RFB status or the WebView DOM. The
    // fixture paints six alternating teal/blue/gold tiles across the desktop.
    private static func hasFixtureFramebuffer(_ screenshot: XCUIScreenshot) -> Bool {
        guard let image = screenshot.image.cgImage else { return false }
        let width = 160
        let height = max(1, image.height * width / image.width)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        return pixels.withUnsafeMutableBytes { bytes in
            guard
                let context = CGContext(
                    data: bytes.baseAddress, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: width * 4,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                        | CGBitmapInfo.byteOrder32Big.rawValue)
            else { return false }
            context.draw(
                image, in: CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
            let colors = [[43, 153, 130], [68, 103, 181], [221, 159, 67]]
            let data = bytes.bindMemory(to: UInt8.self)
            var counts = [0, 0, 0]
            var tiledRow = false
            for y in 0..<height {
                var previous: Int?
                var transitions = 0
                var colored = 0
                for x in 0..<width {
                    let offset = (y * width + x) * 4
                    if let index = colors.firstIndex(where: { color in
                        abs(Int(data[offset]) - color[0]) <= 15
                            && abs(Int(data[offset + 1]) - color[1]) <= 15
                            && abs(Int(data[offset + 2]) - color[2]) <= 15
                    }) {
                        counts[index] += 1
                        colored += 1
                        if let previous, previous != index { transitions += 1 }
                        previous = index
                    }
                }
                if colored >= width / 2 && transitions >= 4 { tiledRow = true }
            }
            return tiledRow && counts.allSatisfy { $0 >= 60 }
        }
    }

    @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
