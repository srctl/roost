import Foundation
import Observation

enum FeedFilter: String, CaseIterable, Identifiable {
    case all, saved
    var id: String { rawValue }
    var title: String { rawValue.capitalized }

    func includes(_ item: FeedItem) -> Bool {
        !item.dismissed && (self != .saved || item.saved)
    }
}

struct FeedItem: Codable, Identifiable, Hashable {
    let id: String
    let kind: String
    let title: String
    let summary: String
    let body: String
    let url: String?
    let imageUrl: String?
    let sourceName: String
    let sourceUrl: String?
    let authorAgentId: String?
    let publishedAt: Double
    let createdAt: Double
    let readAt: Double?
    let saved: Bool
    let dismissed: Bool
    let topics: [String]
    let why: String
    let importance: String
    let score: Double?
    let scoring: String
    let citations: [Citation]

    struct Citation: Codable, Hashable {
        let title: String
        let url: String
    }

    var attribution: String {
        switch kind {
        case "update": "Personal update · " + sourceName
        case "story": "Roost story · " + sourceName
        default: sourceName
        }
    }
}

struct FeedSection: Identifiable {
    enum Period: Int, Hashable {
        case morning, afternoon, evening

        var title: String {
            switch self {
            case .morning: "This morning"
            case .afternoon: "This afternoon"
            case .evening: "This evening"
            }
        }
    }

    struct ID: Hashable {
        let day: Date
        let period: Period?
    }

    let id: ID
    let title: String
    let items: [FeedItem]

    static func grouped(
        _ items: [FeedItem], now: Date = Date(), calendar: Calendar = .current,
        locale: Locale = .current
    ) -> [FeedSection] {
        let today = calendar.startOfDay(for: now)
        // A calendar day can be 23 or 25 hours across daylight-saving changes.
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)
        let grouped = Dictionary(grouping: items) { item in
            let published = Date(timeIntervalSince1970: item.publishedAt / 1000)
            let day = calendar.startOfDay(for: published)
            let period: Period?
            if day == today {
                switch calendar.component(.hour, from: published) {
                case ..<12: period = .morning
                case ..<17: period = .afternoon
                default: period = .evening
                }
            } else {
                period = nil
            }
            return ID(day: day, period: period)
        }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return grouped.keys
            .sorted { first, second in
                if first.day != second.day { return first.day > second.day }
                return (first.period?.rawValue ?? -1) > (second.period?.rawValue ?? -1)
            }
            .map { id in
                let title =
                    id.period?.title
                    ?? (id.day == yesterday ? "Yesterday" : formatter.string(from: id.day))
                let items = grouped[id, default: []]
                    .sorted { first, second in
                        if first.publishedAt != second.publishedAt {
                            return first.publishedAt > second.publishedAt
                        }
                        return first.id < second.id
                    }
                return FeedSection(id: id, title: title, items: items)
            }
    }
}

struct FeedSource: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var url: String
    var enabled: Bool
}

struct FeedSettings: Codable, Equatable {
    var revision: Int
    var enabled: Bool
    var interests: String
    var priorities: String
    var agentId: String?
    var refreshMinutes: Int
    var sources: [FeedSource]
    var emailEnabled: Bool
    var jevEnabled: Bool
    var scorePrivateUpdates: Bool
    let jevConfigured: Bool
    let jevKeySource: String?
}

// Never echo server-only key metadata, or an unchanged masked key, back into a save.
struct FeedSettingsWrite: Encodable {
    let revision: Int
    let enabled: Bool
    let interests: String
    let priorities: String
    let agentId: String?
    let refreshMinutes: Int
    let sources: [FeedSource]
    let emailEnabled: Bool
    let jevEnabled: Bool
    let scorePrivateUpdates: Bool
    let apiKey: String?

    init(settings: FeedSettings, apiKey: String) {
        revision = settings.revision
        enabled = settings.enabled
        interests = settings.interests
        priorities = settings.priorities
        agentId = settings.agentId
        refreshMinutes = settings.refreshMinutes
        sources = settings.sources
        emailEnabled = settings.emailEnabled
        jevEnabled = settings.jevEnabled
        scorePrivateUpdates = settings.scorePrivateUpdates
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        self.apiKey = trimmed.isEmpty ? nil : trimmed
    }

    enum CodingKeys: String, CodingKey {
        case revision, enabled, interests, priorities, agentId, refreshMinutes, sources
        case emailEnabled, jevEnabled, scorePrivateUpdates, apiKey
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(revision, forKey: .revision)
        try values.encode(enabled, forKey: .enabled)
        try values.encode(interests, forKey: .interests)
        try values.encode(priorities, forKey: .priorities)
        // Explicit null clears a previous contributor; omission would retain the old agent.
        try values.encode(agentId, forKey: .agentId)
        try values.encode(refreshMinutes, forKey: .refreshMinutes)
        try values.encode(sources, forKey: .sources)
        try values.encode(emailEnabled, forKey: .emailEnabled)
        try values.encode(jevEnabled, forKey: .jevEnabled)
        try values.encode(scorePrivateUpdates, forKey: .scorePrivateUpdates)
        try values.encodeIfPresent(apiKey, forKey: .apiKey)
    }
}

struct FeedStatus: Decodable {
    let refreshing: Bool
    let lastRefreshedAt: Double?
    let lastError: String?
    let scoring: String
}

struct FeedSnapshot: Decodable {
    let items: [FeedItem]
    let nextCursor: Double?
    let settings: FeedSettings
    let status: FeedStatus
}

struct FeedDiscussion: Decodable, Hashable {
    let agentId: String
    let conversationId: String
}

@MainActor @Observable final class FeedModel {
    let api: RoostAPI
    var filter = FeedFilter.all
    private(set) var items: [FeedItem] = []
    private(set) var settings: FeedSettings?
    private(set) var status: FeedStatus?
    private(set) var nextCursor: Double?
    private(set) var loading = false
    private(set) var loadingMore = false
    private(set) var changing: Set<String> = []
    var error: String?
    var notice: String?
    private(set) var lastDismissed: FeedItem?
    private var generation = 0
    private var mutationGeneration = 0
    private var discussionRequests: [String: String] = [:]

    init(api: RoostAPI) { self.api = api }

    var visibleItems: [FeedItem] { items.filter(filter.includes) }

    func sections(
        now: Date = Date(), calendar: Calendar = .current, locale: Locale = .current
    ) -> [FeedSection] {
        FeedSection.grouped(visibleItems, now: now, calendar: calendar, locale: locale)
    }

    func load(more: Bool = false) async {
        if more && (loadingMore || loading || nextCursor == nil) { return }
        let requestedFilter = filter
        let requestedMutation = mutationGeneration
        if more {
            loadingMore = true
        } else {
            generation += 1
            loading = true
        }
        let requestedGeneration = generation
        defer {
            if more { loadingMore = false }
            if generation == requestedGeneration && !more { loading = false }
        }
        do {
            var query = [URLQueryItem(name: "filter", value: requestedFilter.rawValue)]
            if more, let nextCursor {
                query.append(URLQueryItem(name: "before", value: String(Int64(nextCursor))))
            }
            let snapshot: FeedSnapshot = try await api.get("feed", query: query)
            try Task.checkCancellation()
            guard filter == requestedFilter, generation == requestedGeneration else { return }
            // An older GET must not undo a save, dismissal, or read acknowledgment.
            guard mutationGeneration == requestedMutation else { return }
            if more {
                let known = Set(items.map(\.id))
                items += snapshot.items.filter { !known.contains($0.id) }
            } else {
                items = snapshot.items
            }
            settings = snapshot.settings
            status = snapshot.status
            nextCursor = snapshot.nextCursor
            error = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {} catch { self.error = error.localizedDescription }
    }

    func refresh() async {
        guard status?.refreshing != true else {
            await load()
            return
        }
        do {
            let data = try await api.post("feed/refresh", [String: String]())
            status = try JSONDecoder().decode(FeedStatus.self, from: data)
            await load()
        } catch { self.error = error.localizedDescription }
    }

    nonisolated static func applying(_ updated: FeedItem, action: String, to items: [FeedItem])
        -> [FeedItem]
    {
        var result = items
        if let index = result.firstIndex(where: { $0.id == updated.id }) {
            result[index] = updated
        } else if action == "restore" {
            // A refresh can remove a dismissed item before Undo is tapped.
            // Put its confirmed restoration back into the local collection;
            // chronological sections determine its visible position.
            result.append(updated)
        }
        return result
    }

    @discardableResult func act(_ item: FeedItem, _ action: String) async -> FeedItem? {
        guard !changing.contains(item.id) else { return nil }
        changing.insert(item.id)
        mutationGeneration += 1
        defer {
            changing.remove(item.id)
            mutationGeneration += 1
        }
        do {
            let data = try await api.post("feed/items/\(item.id)", ["action": action])
            let updated = try JSONDecoder().decode(FeedItem.self, from: data)
            items = Self.applying(updated, action: action, to: items)
            if action == "more" { notice = "Feed preferences updated." }
            if action == "dismiss" || action == "less" {
                lastDismissed = updated
                notice = action == "less" ? "Fewer stories like this." : "Removed from your feed."
            }
            if action == "restore" {
                lastDismissed = nil
                notice = "Restored to your feed."
            }
            error = nil
            return updated
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func saveSettings(_ settings: FeedSettings, apiKey: String) async throws {
        mutationGeneration += 1
        defer { mutationGeneration += 1 }
        let data = try await api.post(
            "feed/settings", FeedSettingsWrite(settings: settings, apiKey: apiKey))
        self.settings = try JSONDecoder().decode(FeedSettings.self, from: data)
        error = nil
    }

    func discuss(_ item: FeedItem) async throws -> FeedDiscussion {
        // Keep the same receipt on ambiguous network failures so Retry cannot create another chat.
        let requestId = discussionRequests[item.id] ?? UUID().uuidString
        discussionRequests[item.id] = requestId
        let data = try await api.post("feed/items/\(item.id)/discuss", ["requestId": requestId])
        return try JSONDecoder().decode(FeedDiscussion.self, from: data)
    }
}
