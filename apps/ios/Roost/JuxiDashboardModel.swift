import Foundation
import Observation

/// Focus is selected from the application's authored views, never from model-authored UI.
enum DashboardFocus: String, Codable, CaseIterable, Identifiable {
    case all, summary, charts, tables, tasks

    var id: String { rawValue }
    var title: String { self == .all ? "Everything" : rawValue.capitalized }
    var symbol: String {
        switch self {
        case .all: "square.grid.2x2"
        case .summary: "text.alignleft"
        case .charts: "chart.xyaxis.line"
        case .tables: "tablecells"
        case .tasks: "checklist"
        }
    }

    func includes(_ block: DashboardBlock) -> Bool {
        switch self {
        case .all: true
        case .summary: ["metrics", "markdown", "weather"].contains(block.type)
        case .charts: ["chart", "dataset-chart"].contains(block.type)
        case .tables: ["table", "calorie-log"].contains(block.type)
        case .tasks: ["tasks", "todo-list"].contains(block.type)
        }
    }
}

struct DashboardPresentationRequest: Encodable {
    let revision: Int
    var focus: DashboardFocus?
    var intent: String?
}

struct DashboardTransport {
    var load: () async throws -> DashboardSnapshot
    var present: (DashboardPresentationRequest) async throws -> DashboardPresentation
    var enable: () async throws -> Void
    var action: (DashboardActionRequest) async throws -> DashboardWidget
    var create: (DashboardTrackerRequest) async throws -> DashboardWidget
    var weather: (String, String, Bool) async throws -> WeatherReport
    var locations: (String) async throws -> [WeatherLocation]

    init(api: RoostAPI, agentId: String, chatKey: String? = nil) {
        let path = "agents/\(agentId)/dashboard"
        load = {
            if let chatKey {
                let snapshot: DashboardSnapshot = try await api.get(
                    path + "/chat", query: [URLQueryItem(name: "key", value: chatKey)])
                return try Self.validateChat(snapshot, key: chatKey)
            }
            return try await api.get(path)
        }
        present = { request in
            let data = try await api.post(path + "/presentation", request)
            do {
                return try JSONDecoder().decode(DashboardPresentation.self, from: data)
            } catch {
                throw APIError(
                    message: "Roost could not read this dashboard view. Update Roost and try again."
                )
            }
        }
        enable = { _ = try await api.post(path, ["enabled": true]) }
        action = {
            try JSONDecoder()
                .decode(DashboardWidget.self, from: await api.post(path + "/action", $0))
        }
        create = {
            try JSONDecoder()
                .decode(DashboardWidget.self, from: await api.post(path + "/tracker", $0))
        }
        weather = { key, blockId, refresh in
            var query = [
                URLQueryItem(name: "key", value: key),
                URLQueryItem(name: "blockId", value: blockId),
            ]
            if refresh { query.append(URLQueryItem(name: "refresh", value: "true")) }
            return try await api.get(path + "/weather", query: query)
        }
        locations = { query in
            try await api.get(
                path + "/weather/locations", query: [URLQueryItem(name: "query", value: query)])
        }
    }

    static func validateChat(_ snapshot: DashboardSnapshot, key: String) throws -> DashboardSnapshot
    {
        guard snapshot.widgets.count <= 1, snapshot.widgets.allSatisfy({ $0.key == key }) else {
            throw APIError(
                message: "This tracker does not match its chat reference. Refresh and try again.")
        }
        return snapshot
    }

    init(
        load: @escaping () async throws -> DashboardSnapshot,
        present: @escaping (DashboardPresentationRequest) async throws -> DashboardPresentation,
        enable: @escaping () async throws -> Void = {},
        action: @escaping (DashboardActionRequest) async throws -> DashboardWidget = { _ in
            throw APIError(message: "Tracker unavailable")
        },
        create: @escaping (DashboardTrackerRequest) async throws -> DashboardWidget = { _ in
            throw APIError(message: "Tracker unavailable")
        },
        weather: @escaping (String, String, Bool) async throws -> WeatherReport = { _, _, _ in
            throw APIError(message: "Weather unavailable")
        },
        locations: @escaping (String) async throws -> [WeatherLocation] = { _ in
            throw APIError(message: "Search unavailable")
        }
    ) {
        self.load = load
        self.present = present
        self.enable = enable
        self.action = action
        self.create = create
        self.weather = weather
        self.locations = locations
    }
}

@MainActor @Observable final class JuxiDashboardModel {
    private(set) var snapshot: DashboardSnapshot?
    private(set) var error: String?
    private(set) var updating = false
    var intentDraft = ""
    var trackerDrafts: [String: DashboardTrackerDraft] = [:]
    private(set) var trackerRequests: [String: DashboardActionRequest] = [:]
    private(set) var trackerErrors: [String: String] = [:]
    private(set) var pendingTrackerCreation: DashboardTrackerRequest?
    let weatherLocationSearch = WeatherLocationSearch()
    private let transport: DashboardTransport
    private var generation = 0
    private var refreshID = 0
    private var loadedIntent = false
    private var active = true
    @ObservationIgnored private var weatherCards: [String: WeatherCardModel] = [:]

    init(transport: DashboardTransport) { self.transport = transport }

    func invalidate() {
        active = false
        generation += 1
        for card in weatherCards.values { card.invalidate() }
    }

    func weatherCard(key: String, blockId: String) -> WeatherCardModel {
        let token = key + "/" + blockId
        if let existing = weatherCards[token] { return existing }
        let card = WeatherCardModel { [transport] refresh in
            try await transport.weather(key, blockId, refresh)
        }
        if !active { card.invalidate() }
        weatherCards[token] = card
        return card
    }

    func weatherLocations(query: String) async throws -> [WeatherLocation] {
        guard active else { throw CancellationError() }
        return try await transport.locations(query)
    }

    func refresh() async {
        guard active, !updating else { return }
        await load()
    }

    @discardableResult private func load(clearError: Bool = true) async -> Bool {
        guard active else { return false }
        refreshID += 1
        let request = refreshID
        let generation = self.generation
        do {
            var incoming = try await transport.load()
            guard active, !Task.isCancelled, generation == self.generation, request == refreshID
            else {
                return false
            }
            // A delayed replica or refresh must never replace a newer confirmed selection.
            if incoming.enabled, !incoming.widgets.isEmpty, let existing = snapshot?.presentation,
                existing.revision > (incoming.presentation?.revision ?? -1)
            {
                incoming.presentation = existing
            }
            snapshot = incoming
            if !loadedIntent {
                intentDraft = incoming.presentation?.intent ?? ""
                loadedIntent = true
            }
            if clearError { error = nil }
            return true
        } catch {
            guard !Task.isCancelled, generation == self.generation, request == refreshID else {
                return false
            }
            self.error = error.localizedDescription
            return false
        }
    }

    func select(_ focus: DashboardFocus) async {
        await present(focus: focus)
    }

    func adapt() async {
        let intent = intentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !intent.isEmpty else { return }
        await present(intent: intent)
    }

    func reset() async { await present(intent: "") }

    private func present(focus: DashboardFocus? = nil, intent: String? = nil) async {
        guard active, !updating, let presentation = snapshot?.presentation else { return }
        let submittedDraft = intentDraft
        let replacesDraft = intent != nil || intentDraft == presentation.intent
        updating = true
        generation += 1
        error = nil
        defer { updating = false }
        do {
            let result = try await transport.present(
                DashboardPresentationRequest(
                    revision: presentation.revision, focus: focus, intent: intent))
            guard active, !Task.isCancelled else { return }
            if result.revision >= (snapshot?.presentation?.revision ?? -1) {
                snapshot?.presentation = result
                if replacesDraft && intentDraft == submittedDraft { intentDraft = result.intent }
            }
        } catch let failure as APIError where failure.status == 409 {
            guard active else { return }
            let reloaded = await load(clearError: false)
            if reloaded {
                error =
                    "This dashboard changed on another device. The latest view is loaded; try your change again."
            } else if !Task.isCancelled {
                error =
                    "This dashboard changed on another device. Pull to refresh before trying again."
            }
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    func trackerAction(_ input: DashboardActionRequest) async -> Bool {
        guard active, !updating else { return false }
        let token = input.key + "/" + input.blockId
        let request = trackerRequests[token] ?? input
        trackerRequests[token] = request
        trackerErrors[token] = nil
        updating = true
        generation += 1
        defer { updating = false }
        do {
            let widget = try await transport.action(request)
            guard active, !Task.isCancelled else { return false }
            mergeWidget(widget)
            trackerRequests[token] = nil
            if request.action == .addTodo,
                trackerDrafts[token]?.todo.trimmingCharacters(in: .whitespacesAndNewlines)
                    == request.label
            {
                trackerDrafts[token]?.todo = ""
            }
            if request.action == .addMeal,
                trackerDrafts[token]?.meal.trimmingCharacters(in: .whitespacesAndNewlines)
                    == request.label,
                DashboardTrackerValues.calories(trackerDrafts[token]?.calories ?? "")
                    == request.calories
            {
                trackerDrafts[token]?.meal = ""
                trackerDrafts[token]?.calories = ""
            }
            return true
        } catch let failure as APIError where failure.status == 409 {
            guard active else { return false }
            trackerRequests[token] = nil
            let reloaded = await load(clearError: false)
            trackerErrors[token] =
                reloaded
                ? "This tracker changed. Your draft is kept; review the latest entries and try again."
                : "This tracker changed. Your draft is kept; refresh before trying again."
        } catch {
            if (error as? APIError)?.status == 400 { trackerRequests[token] = nil }
            if !Task.isCancelled { trackerErrors[token] = error.localizedDescription }
        }
        return false
    }

    func createTracker(_ input: DashboardTrackerRequest) async -> Bool {
        guard active, !updating else { return false }
        let request = pendingTrackerCreation ?? input
        pendingTrackerCreation = request
        updating = true
        error = nil
        generation += 1
        do {
            let widget = try await transport.create(request)
            guard active, !Task.isCancelled else {
                updating = false
                return false
            }
            mergeWidget(widget)
            pendingTrackerCreation = nil
            if request.kind == .weather { weatherLocationSearch.query = "" }
            updating = false
            // Creating a tracker should reveal it even when the prior view hid its block type.
            if snapshot?.presentation != nil { await reset() }
            await load(clearError: false)
            if let presentation = snapshot?.presentation,
                presentation.focus != nil || presentation.widgetKey != nil
            {
                error = "Tracker created. Reset the dashboard view to see it."
            }
            return true
        } catch {
            if [400, 409].contains((error as? APIError)?.status ?? 0) {
                pendingTrackerCreation = nil
            }
            updating = false
            if !Task.isCancelled { self.error = error.localizedDescription }
            return false
        }
    }

    private func mergeWidget(_ widget: DashboardWidget) {
        guard let current = snapshot else { return }
        if let index = current.widgets.firstIndex(where: { $0.key == widget.key }) {
            if (widget.revision ?? 0) >= (current.widgets[index].revision ?? 0) {
                snapshot?.widgets[index] = widget
            }
        } else {
            snapshot?.widgets.append(widget)
        }
    }

    func enable() async {
        guard active, !updating else { return }
        updating = true
        generation += 1
        defer { updating = false }
        do {
            try await transport.enable()
            await load()
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }
}
