import Foundation
import Observation

struct AutomationSchedule: Codable, Hashable {
    var kind = "weekly"
    var timezone: String? = TimeZone.current.identifier
    var days: [Int]?
    var time: String?
    var minutes: Int?
    var at: String?
    var expression: String?
    var startsOn: String?
    var endsOn: String?

    var summary: String {
        switch kind {
        case "interval":
            let value = minutes ?? 60
            if value == 60 { return "Every hour" }
            if value == 1 { return "Every minute" }
            return value % 60 == 0 ? "Every \(value / 60) hours" : "Every \(value) minutes"
        case "once":
            return Self.parseDate(at)?.formatted(date: .abbreviated, time: .shortened) ?? "One time"
        case "cron": return expression ?? "Custom schedule"
        default:
            let selected = Set(days ?? [])
            let label =
                selected.count == 7
                ? "Every day"
                : selected == Set([1, 2, 3, 4, 5])
                    ? "Weekdays"
                    : (0...6).filter { selected.contains($0) }
                        .map { Calendar.current.shortWeekdaySymbols[$0] }.joined(separator: ", ")
            return "\(label) at \(time ?? "09:00")"
        }
    }

    static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
}

struct AgentAutomation: Codable, Identifiable, Equatable {
    let id: String
    let agentId: String
    let name: String
    let prompt: String
    let schedule: AutomationSchedule
    let notification: String
    let model: String?
    let revision: Int
    let enabled: Bool
    let nextRunAt: Double?
}

struct AutomationRunSummary: Decodable, Identifiable {
    let id: String
    let kind: String
    let status: String
    let createdAt: Double
    let automationName: String?
    var active: Bool { ["queued", "running", "steering"].contains(status) }
    var title: String {
        switch kind {
        case "automation": automationName ?? "Automation"
        case "delegation": "Delegated task"
        case "handoff": "Specialist update"
        case "reflection": "Reflection"
        case "coding": "Coding update"
        default: "Chat"
        }
    }
}

struct AutomationRun: Decodable, Identifiable {
    let id: String
    let status: String
    let createdAt: Double
    let startedAt: Double?
    let finishedAt: Double?
    let prompt: String
    let error: String?
    let messages: String
    let soulRevision: String?
    var active: Bool { ["queued", "running", "steering"].contains(status) }
    var output: [Message] {
        ((try? JSONDecoder().decode([Message].self, from: Data(messages.utf8))) ?? [])
            .filter { $0.role != "user" }
    }
}

struct AutomationSnapshot: Decodable {
    let automations: [AgentAutomation]
    let runs: [AutomationRunSummary]
}

struct AutomationPreview: Decodable {
    let runs: [Double]
    let label: String
}

struct AutomationModelOption: Decodable, Identifiable {
    let model: String
    let displayName: String
    var id: String { model }
}

// Keep schedule edits in their original wall-clock timezone. Changing the
// device timezone must not silently move an existing automation's run time.
struct AutomationDraft: Codable, Equatable, Identifiable {
    var id = UUID().uuidString
    var name = ""
    var prompt = ""
    var kind = "weekly"
    var timezone = TimeZone.current.identifier
    var days = [1, 2, 3, 4, 5]
    var time = "09:00"
    var minutes = "60"
    var at = Date().addingTimeInterval(3600)
    var expression = "0 9 * * *"
    var startsOn = ""
    var endsOn = ""
    var notification = "when-needed"
    var model = ""
    var expectedRevision: Int?

    init(automation: AgentAutomation? = nil) {
        guard let automation else { return }
        id = automation.id
        name = automation.name
        prompt = automation.prompt
        kind = automation.schedule.kind
        timezone = automation.schedule.timezone ?? TimeZone.current.identifier
        days = automation.schedule.days ?? days
        time = automation.schedule.time ?? time
        minutes = String(automation.schedule.minutes ?? 60)
        at = AutomationSchedule.parseDate(automation.schedule.at) ?? at
        expression = automation.schedule.expression ?? expression
        startsOn = automation.schedule.startsOn ?? ""
        endsOn = automation.schedule.endsOn ?? ""
        notification = automation.notification
        model = automation.model ?? ""
        expectedRevision = automation.revision
    }

    var schedule: AutomationSchedule {
        var value = AutomationSchedule(kind: kind, timezone: timezone)
        switch kind {
        case "once": value.at = ISO8601DateFormatter().string(from: at)
        case "interval": value.minutes = Int(minutes)
        case "cron": value.expression = expression.trimmingCharacters(in: .whitespacesAndNewlines)
        default:
            value.days = days.sorted()
            value.time = time
        }
        if kind != "once" {
            value.startsOn = startsOn.isEmpty ? nil : startsOn
            value.endsOn = endsOn.isEmpty ? nil : endsOn
        }
        return value
    }

    var valid: Bool {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, trimmedName.count <= 200,
            !trimmedPrompt.isEmpty, trimmedPrompt.count <= 16_000,
            TimeZone(identifier: timezone) != nil
        else { return false }
        if kind == "weekly", days.isEmpty { return false }
        if kind == "interval", !(1...525_600).contains(Int(minutes) ?? 0) { return false }
        if kind == "cron", expression.split(whereSeparator: \.isWhitespace).count != 5 {
            return false
        }
        return true
    }
}

struct AutomationSave: Encodable {
    let draft: AutomationDraft
    enum CodingKeys: String, CodingKey {
        case id, name, prompt, schedule, notification, model, expectedRevision
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.container(keyedBy: CodingKeys.self)
        try value.encode(draft.id, forKey: .id)
        try value.encode(draft.name.trimmingCharacters(in: .whitespacesAndNewlines), forKey: .name)
        try value.encode(
            draft.prompt.trimmingCharacters(in: .whitespacesAndNewlines), forKey: .prompt)
        try value.encode(draft.schedule, forKey: .schedule)
        try value.encode(draft.notification, forKey: .notification)
        // Omission preserves a previous override; null restores the agent default.
        if draft.model.isEmpty {
            try value.encodeNil(forKey: .model)
        } else {
            try value.encode(draft.model, forKey: .model)
        }
        try value.encodeIfPresent(draft.expectedRevision, forKey: .expectedRevision)
    }
}

@MainActor @Observable final class AutomationsModel {
    let api: RoostAPI
    let agent: Agent
    var snapshot: AutomationSnapshot?
    var error: String?
    var busy = false
    private var refreshing = false
    private var generation = 0
    private var runRequests: [String: String] = [:]
    var path: String { "agents/\(agent.id)/automations" }
    private var runRequestsURL: URL {
        WorkspaceDrafts.url(api: api, agent: agent.id, key: "automation-runs")
    }

    init(api: RoostAPI, agent: Agent) {
        self.api = api
        self.agent = agent
        do {
            runRequests =
                try WorkspaceDrafts.load([String: String].self, from: runRequestsURL) ?? [:]
        } catch { self.error = "Could not restore pending runs. " + error.localizedDescription }
    }

    func refresh() async {
        guard !refreshing, !busy else { return }
        refreshing = true
        let generation = generation
        defer { refreshing = false }
        do {
            let snapshot: AutomationSnapshot = try await api.get(path)
            guard !Task.isCancelled, generation == self.generation else { return }
            self.snapshot = snapshot
            let confirmed = Set(snapshot.runs.map(\.id))
            runRequests = runRequests.filter { !confirmed.contains($0.value) }
            try WorkspaceDrafts.save(runRequests, to: runRequestsURL)
            error = nil
        } catch {
            if !Task.isCancelled, generation == self.generation {
                self.error = error.localizedDescription
            }
        }
    }

    func save(_ draft: AutomationDraft) async throws {
        guard !busy else {
            throw APIError(
                message: "Wait for the current automation update to finish, then save again.")
        }
        busy = true
        generation += 1
        defer { busy = false }
        let data = try await api.post(path, AutomationSave(draft: draft))
        let saved = try JSONDecoder().decode(AgentAutomation.self, from: data)
        var automations = snapshot?.automations ?? []
        if let index = automations.firstIndex(where: { $0.id == saved.id }) {
            automations[index] = saved
        } else {
            automations.append(saved)
        }
        // Apply the confirmed save before refreshing history. A stale poll must
        // never undo it, and a failed history refresh must not turn it into a
        // failed save that would conflict when retried.
        snapshot = AutomationSnapshot(automations: automations, runs: snapshot?.runs ?? [])
        error = nil
        do {
            snapshot = try await api.get(path)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggle(_ automation: AgentAutomation) async {
        struct Toggle: Encodable {
            let revision: Int
            let enabled: Bool
        }
        await perform {
            _ = try await self.api.post(
                self.path + "/\(automation.id)/toggle",
                Toggle(revision: automation.revision, enabled: !automation.enabled))
        }
    }

    func delete(_ automation: AgentAutomation) async {
        await perform {
            _ = try await self.api.request(
                self.path + "/\(automation.id)", method: "DELETE",
                body: JSONEncoder().encode(["revision": automation.revision]))
        }
    }

    func runNow(_ automation: AgentAutomation) async {
        await perform {
            let requestId = self.runRequests[automation.id] ?? UUID().uuidString
            self.runRequests[automation.id] = requestId
            try WorkspaceDrafts.save(self.runRequests, to: self.runRequestsURL)
            _ = try await self.api.post(
                self.path + "/\(automation.id)/run", ["requestId": requestId])
            self.runRequests.removeValue(forKey: automation.id)
            try WorkspaceDrafts.save(self.runRequests, to: self.runRequestsURL)
        }
    }

    func stop(_ id: String) async {
        await perform {
            _ = try await self.api.post(
                "agents/\(self.agent.id)/runs/\(id)/stop", [String: String]())
        }
    }

    private func perform(_ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        generation += 1
        error = nil
        do {
            try await action()
            snapshot = try await api.get(path)
            busy = false
        } catch {
            busy = false
            self.error = error.localizedDescription
        }
    }
}
