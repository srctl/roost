import Observation
import SwiftUI

enum WeatherUnit: String, Codable, CaseIterable, Identifiable {
    case celsius, fahrenheit
    var id: String { rawValue }
    var symbol: String { self == .celsius ? "°C" : "°F" }
}

struct WeatherLocation: Decodable, Identifiable, Equatable {
    let id: Int
    let name: String
    let region: String
    let country: String
    let latitude: Double
    let longitude: Double
    let timezone: String
    var detail: String { [region, country].filter { !$0.isEmpty }.joined(separator: ", ") }
}

struct WeatherReport: Decodable {
    let location: WeatherLocation
    let unit: WeatherUnit
    let updatedAt: String
    let observedAt: String
    let current: Current
    let days: [Day]
    let stale: Bool
    let notice: String?
    struct Current: Decodable {
        let temperature: Double
        let feelsLike: Double
        let weatherCode: Int
        let isDay: Bool
        let windSpeed: Double
    }
    struct Day: Decodable, Identifiable {
        let date: String
        let weatherCode: Int
        let high: Double
        let low: Double
        let precipitationProbability: Double
        var id: String { date }
    }
}

enum WeatherText {
    // WMO interpretation codes documented at https://open-meteo.com/en/docs.
    static func condition(_ code: Int) -> String {
        switch code {
        case 0: "Clear skies"
        case 1: "Mostly clear"
        case 2: "Partly cloudy"
        case 3: "Overcast"
        case 45, 48: "Fog"
        case 51, 53, 55: "Drizzle"
        case 56, 57: "Freezing drizzle"
        case 61: "Light rain"
        case 63: "Rain"
        case 65: "Heavy rain"
        case 66, 67: "Freezing rain"
        case 71: "Light snow"
        case 73, 75, 77: "Snow"
        case 80, 81, 82: "Rain showers"
        case 85, 86: "Snow showers"
        case 95: "Thunderstorms"
        case 96, 99: "Thunderstorms with hail"
        default: "Conditions unavailable"
        }
    }
    static func symbol(_ code: Int, isDay: Bool = true) -> String {
        switch code {
        case 0, 1: isDay ? "sun.max" : "moon.stars"
        case 2: isDay ? "cloud.sun" : "cloud.moon"
        case 3: "cloud"
        case 45, 48: "cloud.fog"
        case 51...57: "cloud.drizzle"
        case 61...67, 80...82: "cloud.rain"
        case 71...77, 85, 86: "cloud.snow"
        case 95, 96, 99: "cloud.bolt.rain"
        default: "questionmark.circle"
        }
    }
    static func temperature(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0))) + "°"
    }
    static func instant(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
    static func updated(_ date: Date, timezone: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: timezone) ?? TimeZone(secondsFromGMT: 0)
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date) + " "
            + (formatter.timeZone.abbreviation(for: date) ?? timezone)
    }
    static func day(_ value: String, timezone: String, now: Date = .now) -> String {
        if let zone = TimeZone(identifier: timezone),
            DashboardTrackerValues.day(now, timeZone: zone) == value
        {
            return "Today"
        }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: value) else { return value }
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("EEE")
        return formatter.string(from: date)
    }
}

@MainActor @Observable final class WeatherCardModel {
    private(set) var report: WeatherReport?
    private(set) var error: String?
    private(set) var loading = false
    private let fetch: (Bool) async throws -> WeatherReport
    private var configuration = ""
    private var generation = 0
    private var loadedAt: Date?
    private var active = true
    init(fetch: @escaping (Bool) async throws -> WeatherReport) { self.fetch = fetch }
    func invalidate() {
        active = false
        generation += 1
    }

    func load(locationId: Int, unit: WeatherUnit, refresh: Bool = false, now: Date = .now) async {
        guard active else { return }
        let key = "\(locationId)/\(unit.rawValue)"
        if configuration != key {
            configuration = key
            generation += 1
            report = nil
            error = nil
            loading = false
            loadedAt = nil
        }
        guard !loading, refresh || loadedAt.map({ now.timeIntervalSince($0) >= 60 }) != false else {
            return
        }
        let generation = self.generation
        loading = true
        defer { if generation == self.generation { loading = false } }
        do {
            let report = try await fetch(refresh)
            guard active, !Task.isCancelled, generation == self.generation else { return }
            guard report.location.id == locationId, report.unit == unit else {
                throw APIError(
                    message:
                        "Weather settings changed. Refresh the tracker to load its current location and units."
                )
            }
            self.report = report
            error = nil
            loadedAt = now
        } catch {
            if active, !Task.isCancelled, generation == self.generation {
                if let report,
                    WeatherText.instant(report.updatedAt).map({ now.timeIntervalSince($0) > 86400 })
                        != false
                {
                    self.report = nil
                }
                self.error = error.localizedDescription
            }
        }
    }
}

@MainActor @Observable final class WeatherLocationSearch {
    var query = "" {
        didSet {
            if query != oldValue {
                generation += 1
                selected = nil
                results = []
                loading = false
                error = nil
                searched = false
            }
        }
    }
    var selected: WeatherLocation?
    private(set) var results: [WeatherLocation] = []
    private(set) var loading = false
    private(set) var error: String?
    private(set) var searched = false
    private var generation = 0
    var canSearch: Bool {
        (2...100).contains(query.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)
            && !loading
    }
    func search(using fetch: (String) async throws -> [WeatherLocation]) async {
        guard canSearch else { return }
        generation += 1
        let generation = self.generation
        loading = true
        defer { if generation == self.generation { loading = false } }
        error = nil
        do {
            let results = try await fetch(query.trimmingCharacters(in: .whitespacesAndNewlines))
            guard !Task.isCancelled, generation == self.generation else { return }
            self.results = results
            searched = true
        } catch {
            if !Task.isCancelled, generation == self.generation {
                self.error = error.localizedDescription
            }
        }
    }
}

struct DashboardWeatherView: View {
    @Environment(\.palette) private var palette
    @Environment(\.dashboardCardContext) private var context
    @Environment(JuxiDashboardModel.self) private var dashboard
    let widgetKey: String
    let revision: Int?
    let block: DashboardBlock
    private var blockId: String { block.id ?? "" }
    private var token: String { widgetKey + "/" + blockId }
    private var unit: WeatherUnit { block.unit ?? .celsius }
    private var model: WeatherCardModel { dashboard.weatherCard(key: widgetKey, blockId: blockId) }
    private var locked: Bool {
        dashboard.updating || dashboard.trackerRequests[token] != nil || revision == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let report = model.report, report.unit == unit,
                report.location.id == block.locationId
            {
                content(report)
            } else if model.error == nil {
                ProgressView("Loading weather…")
            }
            if let error = model.error {
                ErrorNotice(
                    text: model.report == nil
                        ? error
                        : "Could not update weather. Showing the last available forecast. " + error)
            }
            if let error = dashboard.trackerErrors[token] {
                ErrorNotice(text: error)
                if let pending = dashboard.trackerRequests[token] {
                    Button("Retry unit change") {
                        Task { _ = await dashboard.trackerAction(pending) }
                    }
                    .disabled(dashboard.updating)
                }
            }
            HStack {
                Link(
                    "Weather data by Open-Meteo",
                    destination: URL(string: "https://open-meteo.com/")!
                )
                .font(.caption)
                Spacer()
                Button {
                    Task { await load(refresh: true) }
                } label: {
                    Label("Refresh weather", systemImage: "arrow.clockwise").labelStyle(.iconOnly)
                }
                .frame(minWidth: 44, minHeight: 44).disabled(model.loading || locked)
                .accessibilityIdentifier(context.identifier("weather-refresh-\(blockId)"))
            }
            if model.loading && model.report != nil {
                ProgressView("Updating weather…").font(.caption)
            }
        }
        .task(id: "\(block.locationId ?? 0)/\(unit.rawValue)") {
            while !Task.isCancelled {
                await load()
                do {
                    try await Task.sleep(
                        for: .seconds(model.report == nil && model.error == nil ? 3 : 60))
                } catch { break }
            }
        }
    }
    private func load(refresh: Bool = false) async {
        guard let id = block.locationId, !blockId.isEmpty else { return }
        await model.load(locationId: id, unit: unit, refresh: refresh)
    }
    private func content(_ report: WeatherReport) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(report.location.name).font(.headline)
                    Text(report.location.detail).font(.caption).foregroundStyle(palette.muted)
                }
                Spacer()
                Picker("Temperature unit", selection: Binding(get: { unit }, set: changeUnit)) {
                    ForEach(WeatherUnit.allCases) { Text($0.symbol).tag($0) }
                }
                .pickerStyle(.segmented).frame(width: 112).disabled(locked)
                .accessibilityIdentifier(context.identifier("weather-unit-\(blockId)"))
            }
            HStack(spacing: 16) {
                Image(
                    systemName: WeatherText.symbol(
                        report.current.weatherCode, isDay: report.current.isDay)
                )
                .font(.system(size: 34)).foregroundStyle(palette.accent).accessibilityHidden(true)
                Text(
                    WeatherText.temperature(report.current.temperature)
                        + (report.unit == .celsius ? "C" : "F")
                )
                .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                .accessibilityIdentifier(context.identifier("weather-temperature-\(blockId)"))
                Spacer()
            }
            VStack(alignment: .leading, spacing: 5) {
                Text(WeatherText.condition(report.current.weatherCode))
                    .font(.subheadline.weight(.medium))
                Text(
                    "Feels like \(WeatherText.temperature(report.current.feelsLike)) · Wind \(report.current.windSpeed.formatted(.number.precision(.fractionLength(0)))) km/h"
                )
                .font(.caption).foregroundStyle(palette.muted)
                if let first = report.days.first(where: {
                    WeatherText.day($0.date, timezone: report.location.timezone) == "Today"
                }) {
                    Text(
                        "High \(WeatherText.temperature(first.high)) · Low \(WeatherText.temperature(first.low))"
                    )
                    .font(.caption).foregroundStyle(palette.muted)
                }
            }
            Divider()
            ForEach(Array(report.days.prefix(5))) { day in
                HStack(spacing: 10) {
                    Text(WeatherText.day(day.date, timezone: report.location.timezone))
                        .frame(width: 48, alignment: .leading)
                    Image(systemName: WeatherText.symbol(day.weatherCode)).frame(width: 24)
                        .foregroundStyle(palette.accent)
                    Text(
                        "\(day.precipitationProbability.formatted(.number.precision(.fractionLength(0))))%"
                    )
                    .foregroundStyle(palette.muted)
                    Spacer()
                    Text(WeatherText.temperature(day.high)).fontWeight(.medium)
                    Text(WeatherText.temperature(day.low)).foregroundStyle(palette.muted)
                }
                .font(.subheadline).monospacedDigit()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(
                    "\(day.date), \(WeatherText.condition(day.weatherCode)), high \(WeatherText.temperature(day.high)), low \(WeatherText.temperature(day.low)), precipitation \(day.precipitationProbability.formatted()) percent"
                )
            }
            TimelineView(.periodic(from: .now, by: 60)) { time in
                VStack(alignment: .leading, spacing: 4) {
                    if report.stale
                        || WeatherText.instant(report.updatedAt)
                            .map({ time.date.timeIntervalSince($0) > 900 }) == true
                    {
                        Label(
                            report.notice
                                ?? "Showing an older forecast. Refresh for the latest weather.",
                            systemImage: "clock.badge.exclamationmark"
                        )
                        .font(.caption).foregroundStyle(palette.muted)
                    } else if let notice = report.notice {
                        Text(notice).font(.caption).foregroundStyle(palette.muted)
                    }
                    if let updated = WeatherText.instant(report.updatedAt) {
                        Text(
                            "Updated \(WeatherText.updated(updated, timezone: report.location.timezone))"
                        )
                        .font(.caption).foregroundStyle(palette.muted)
                    }
                    if let observed = WeatherText.instant(report.observedAt) {
                        Text(
                            "Conditions at \(WeatherText.updated(observed, timezone: report.location.timezone))"
                        )
                        .font(.caption).foregroundStyle(palette.muted)
                    }
                }
            }
        }
    }
    private func changeUnit(_ value: WeatherUnit) {
        guard !locked, value != unit, let revision else { return }
        Task {
            _ = await dashboard.trackerAction(
                DashboardActionRequest(
                    key: widgetKey, expectedRevision: revision, blockId: blockId,
                    action: .setWeatherUnit, id: UUID().uuidString, unit: value))
        }
    }
}
