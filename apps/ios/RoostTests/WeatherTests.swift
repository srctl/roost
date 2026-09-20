import XCTest

@testable import Roost

final class WeatherTests: XCTestCase {
    func testWeatherConfigurationParticipatesInSummaryAndEncodesOnlyChosenCityAndUnit() throws {
        let snapshot = try dashboard()
        let block = snapshot.widgets[0].blocks[0]
        XCTAssertTrue(DashboardFocus.summary.includes(block))
        XCTAssertFalse(DashboardFocus.tasks.includes(block))
        let input = DashboardTrackerRequest(
            key: "seattle", kind: .weather, title: "Seattle", locationId: 5_809_844,
            unit: .fahrenheit)
        let object =
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
        XCTAssertEqual(Set(object.keys), ["key", "kind", "title", "locationId", "unit"])
        XCTAssertEqual(object["unit"] as? String, "fahrenheit")
        XCTAssertEqual(block.locationId, 5_809_844)
    }

    func testConditionsAndCivilDatesUseCityTimezoneWithoutMislabelingOldForecastAsToday() throws {
        let now = try XCTUnwrap(WeatherText.instant("2026-09-20T01:30:00.000Z"))
        XCTAssertEqual(
            WeatherText.day("2026-09-19", timezone: "America/Los_Angeles", now: now), "Today")
        XCTAssertNotEqual(
            WeatherText.day("2026-09-18", timezone: "America/Los_Angeles", now: now), "Today")
        XCTAssertNotEqual(
            WeatherText.day("2026-09-20", timezone: "America/Los_Angeles", now: now), "Today")
        XCTAssertTrue(WeatherText.updated(now, timezone: "America/Los_Angeles").hasSuffix("PDT"))
        XCTAssertEqual(WeatherText.condition(67), "Freezing rain")
        XCTAssertEqual(WeatherText.condition(999), "Conditions unavailable")
        XCTAssertEqual(WeatherText.symbol(0, isDay: false), "moon.stars")
    }

    @MainActor func testChangedSearchRejectsOldResultsAndRequiresExplicitSelection() async throws {
        let location = try report().location
        let search = WeatherLocationSearch()
        var resume: CheckedContinuation<[WeatherLocation], Error>?
        let started = expectation(description: "Search pending")
        search.query = "Seattle"
        let first = Task {
            await search.search { _ in
                try await withCheckedThrowingContinuation {
                    resume = $0
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started], timeout: 2)
        search.query = "Portland"
        resume?.resume(returning: [location])
        await first.value
        XCTAssertTrue(search.results.isEmpty)
        XCTAssertFalse(search.loading)
        search.query = "Seattle"
        await search.search { _ in [location] }
        XCTAssertNil(search.selected, "A successful search must not assume a city choice")
        search.selected = location
        search.query = "Another city"
        XCTAssertNil(search.selected)
    }

    @MainActor func testLateCelsiusResponseCannotReplaceNewFahrenheitReport() async throws {
        let celsius = try report()
        let fahrenheit = try report(unit: .fahrenheit)
        var resume: CheckedContinuation<WeatherReport, Error>?
        let started = expectation(description: "Celsius pending")
        var calls = 0
        let model = WeatherCardModel { _ in
            calls += 1
            if calls == 1 {
                return try await withCheckedThrowingContinuation {
                    resume = $0
                    started.fulfill()
                }
            }
            return fahrenheit
        }
        let old = Task { await model.load(locationId: 5_809_844, unit: .celsius) }
        await fulfillment(of: [started], timeout: 2)
        await model.load(locationId: 5_809_844, unit: .fahrenheit)
        resume?.resume(returning: celsius)
        await old.value
        XCTAssertEqual(model.report?.unit, .fahrenheit)
        XCTAssertEqual(model.report?.current.temperature, 68)
        XCTAssertFalse(model.loading)
    }

    @MainActor func testFailedRefreshKeepsReportButMarksErrorAndDeduplicatesOrdinaryReads()
        async throws
    {
        let report = try report(stale: true)
        var calls = 0
        let model = WeatherCardModel { refresh in
            calls += 1
            if refresh { throw APIError(message: "Provider unavailable") }
            return report
        }
        await model.load(locationId: 5_809_844, unit: .celsius)
        await model.load(locationId: 5_809_844, unit: .celsius)
        XCTAssertEqual(calls, 1)
        await model.load(locationId: 5_809_844, unit: .celsius, refresh: true)
        XCTAssertEqual(model.report?.current.temperature, 20)
        XCTAssertEqual(model.report?.stale, true)
        XCTAssertEqual(model.report?.notice, "Showing cached weather.")
        XCTAssertEqual(model.error, "Provider unavailable")
        XCTAssertFalse(model.loading)
    }

    @MainActor func testRowCancellationReleasesLoadingGateAndRejectsMismatchedLocation()
        async throws
    {
        let value = try report()
        var resume: CheckedContinuation<WeatherReport, Error>?
        let started = expectation(description: "First request pending")
        var calls = 0
        let model = WeatherCardModel { _ in
            calls += 1
            if calls == 1 {
                return try await withCheckedThrowingContinuation {
                    resume = $0
                    started.fulfill()
                }
            }
            return value
        }
        let first = Task { await model.load(locationId: 5_809_844, unit: .celsius) }
        await fulfillment(of: [started], timeout: 2)
        first.cancel()
        resume?.resume(returning: value)
        await first.value
        XCTAssertFalse(model.loading)
        XCTAssertNil(model.report)
        await model.load(locationId: 999, unit: .celsius)
        XCTAssertNil(model.report)
        XCTAssertTrue(model.error?.contains("settings changed") == true)
        await model.load(locationId: 5_809_844, unit: .celsius)
        XCTAssertEqual(model.report?.location.id, 5_809_844)
    }

    @MainActor func testUnitConflictReloadsAuthoritativeChoiceAndWeatherCacheOutlivesRows()
        async throws
    {
        let initial = try dashboard()
        let updated = try dashboard(unit: .fahrenheit, revision: 2)
        var reads = 0
        var writes = 0
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: {
                    reads += 1
                    return reads == 1 ? initial : updated
                }, present: { _ in throw APIError(message: "Unused") },
                action: { _ in
                    writes += 1
                    throw APIError(message: "Conflict", status: 409)
                }))
        await model.refresh()
        let first = model.weatherCard(key: "seattle", blockId: "items")
        XCTAssertTrue(first === model.weatherCard(key: "seattle", blockId: "items"))
        _ = await model.trackerAction(
            DashboardActionRequest(
                key: "seattle", expectedRevision: 1, blockId: "items", action: .setWeatherUnit,
                id: "same-request", unit: .fahrenheit))
        XCTAssertEqual(writes, 1)
        XCTAssertEqual(model.snapshot?.widgets[0].blocks[0].unit, .fahrenheit)
        XCTAssertNil(model.trackerRequests["seattle/items"])
    }

    @MainActor func testFailedRefreshDropsReportOlderThanTwentyFourHours() async throws {
        let report = try report()
        let fetched = try XCTUnwrap(WeatherText.instant(report.updatedAt))
        let model = WeatherCardModel { refresh in
            if refresh { throw APIError(message: "Provider unavailable") }
            return report
        }
        await model.load(locationId: 5_809_844, unit: .celsius, now: fetched)
        XCTAssertNotNil(model.report)
        await model.load(
            locationId: 5_809_844, unit: .celsius, refresh: true,
            now: fetched.addingTimeInterval(86401))
        XCTAssertNil(model.report)
        XCTAssertEqual(model.error, "Provider unavailable")
    }

    private func dashboard(unit: WeatherUnit = .celsius, revision: Int = 1) throws
        -> DashboardSnapshot
    {
        try JSONDecoder()
            .decode(
                DashboardSnapshot.self,
                from: Data(
                    """
                    {"enabled":true,"widgets":[{"key":"seattle","title":"Seattle weather","revision":\(revision),"updatedAt":1,"blocks":[{"type":"weather","id":"items","locationId":5809844,"unit":"\(unit.rawValue)"}]}],"datasets":[]}
                    """
                    .utf8))
    }
    private func report(unit: WeatherUnit = .celsius, stale: Bool = false) throws -> WeatherReport {
        try JSONDecoder()
            .decode(
                WeatherReport.self,
                from: Data(
                    """
                    {"location":{"id":5809844,"name":"Seattle","region":"Washington","country":"United States","latitude":47.6062,"longitude":-122.3321,"timezone":"America/Los_Angeles"},"unit":"\(unit.rawValue)","updatedAt":"2026-09-19T20:00:00.000Z","observedAt":"2026-09-19T19:45:00.000Z","current":{"temperature":\(unit == .celsius ? 20 : 68),"feelsLike":19,"weatherCode":2,"isDay":true,"windSpeed":12},"days":[{"date":"2026-09-19","weatherCode":2,"high":22,"low":12,"precipitationProbability":10}],"stale":\(stale),"notice":\(stale ? #""Showing cached weather.""# : "null")}
                    """
                    .utf8))
    }
}
