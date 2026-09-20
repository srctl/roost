import XCTest

final class WeatherUITests: XCTestCase {
    @MainActor func testSearchCreateWeatherSwitchUnitsRefreshAndShowInChat() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate()
        _ = try await request("__fixture/reset", body: [:], fixture: true)
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
        app.buttons["Weather"].tap()
        let create = app.buttons["Create tracker"]
        guard create.waitForExistence(timeout: 5) else {
            throw NSError(domain: "WeatherFormMissing", code: 1)
        }
        XCTAssertFalse(create.isEnabled, "A location must be explicitly selected")
        let query = app.textFields["weather-city-query"]
        query.tap()
        query.typeText("Seattle")
        app.buttons["Search cities"].tap()
        let city = app.buttons["weather-location-5809844"]
        guard city.waitForExistence(timeout: 10) else {
            throw NSError(domain: "CityNotFound", code: 1)
        }
        XCTAssertFalse(create.isEnabled, "Search results do not implicitly select a city")
        city.tap()
        create.tap()
        let temperature = app.staticTexts["weather-temperature-items"]
        guard temperature.waitForExistence(timeout: 10) else {
            throw NSError(domain: "WeatherNotLoaded", code: 1)
        }
        XCTAssertEqual(temperature.label, "20°C")
        XCTAssertTrue(app.staticTexts["Partly cloudy"].exists)
        XCTAssertTrue(app.staticTexts["Feels like 19° · Wind 12 km/h"].exists)
        capture(app, "Native dashboard weather Celsius")
        let units = app.segmentedControls["weather-unit-items"]
        units.buttons["°F"].tap()
        let changed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label == '68°F'"), object: temperature)
        guard await XCTWaiter.fulfillment(of: [changed], timeout: 10) == .completed else {
            throw NSError(domain: "UnitNotChanged", code: 1)
        }
        let refresh = app.buttons["weather-refresh-items"]
        app.scrollViews.firstMatch.swipeUp()
        refresh.tap()
        XCTAssertEqual(temperature.label, "68°F")
        capture(app, "Native dashboard weather forecast")
        let agents = try await request("api/mobile/v1/agents") as! [[String: Any]]
        let agent = agents.first { $0["name"] as? String == "Moss" }!["id"] as! String
        let snapshot =
            try await request("api/mobile/v1/agents/\(agent)/dashboard") as! [String: Any]
        let widgets = snapshot["widgets"] as! [[String: Any]]
        let weather = widgets.first {
            ($0["blocks"] as? [[String: Any]])?.first?["type"] as? String == "weather"
        }!
        let block = (weather["blocks"] as! [[String: Any]])[0]
        XCTAssertEqual(block["unit"] as? String, "fahrenheit")
        XCTAssertEqual(block["locationId"] as? Int, 5_809_844)
        XCTAssertNil(block["current"], "Only weather configuration belongs in the saved widget")
        let shown =
            try await request(
                "__fixture/chat-tracker",
                body: [
                    "key": weather["key"]!, "kind": "weather", "title": weather["title"]!,
                    "locationId": 5_809_844, "unit": "fahrenheit", "complete": true,
                ], fixture: true) as! [String: Any]
        let shownID = try XCTUnwrap(shown["id"] as? String)
        let identifier = "weather-temperature-items-" + agent + "-" + shownID
        app.buttons["workspace-chat"].tap()
        let chatTemperature = app.staticTexts
            .matching(
                NSPredicate(format: "identifier == %@", identifier)
            )
            .firstMatch
        guard chatTemperature.waitForExistence(timeout: 12) else {
            throw NSError(domain: "InlineWeatherMissing", code: 1)
        }
        XCTAssertEqual(chatTemperature.label, "68°F")
        XCTAssertFalse(app.buttons["Stop response"].exists)
        capture(app, "Native weather inside chat")
        let scroll = app.scrollViews.firstMatch
        scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            .press(
                forDuration: 0.05,
                thenDragTo: scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)))
        capture(app, "Native weather chat header")
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
            throw NSError(domain: "WeatherFixtureHTTP", code: status)
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
