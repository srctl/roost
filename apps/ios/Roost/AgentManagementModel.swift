import Foundation
import Observation

struct AgentSection: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let position: Int
    let collapsed: Bool
}

struct AgentNavigation: Decodable, Equatable {
    var sections: [AgentSection]
    var memberships: [String: String]
    var agentOrder: [String]
    var ungroupedPosition: Int

    static let empty = AgentNavigation(
        sections: [], memberships: [:], agentOrder: [], ungroupedPosition: 0)

    func ordered(_ agents: [Agent]) -> [Agent] {
        let positions = Dictionary(
            agentOrder.enumerated().map { ($0.element, $0.offset) },
            uniquingKeysWith: { first, _ in first })
        return agents.enumerated()
            .sorted {
                let lhs = positions[$0.element.id] ?? (agentOrder.count + $0.offset)
                let rhs = positions[$1.element.id] ?? (agentOrder.count + $1.offset)
                return lhs < rhs
            }
            .map(\.element)
    }
}

struct AgentOptions: Decodable {
    struct Model: Decodable, Identifiable {
        let model: String
        let displayName: String
        let isDefault: Bool
        var id: String { model }
    }
    let models: [Model]
    let characters: [String]
}

struct AgentCreation: Encodable, Equatable {
    var id: String
    var name: String
    var instructions: String
    var character: String
    var model: String
    var kind: String
}

struct AgentNavigationChange: Encodable {
    let action: String
    var id: String? = nil
    var name: String? = nil
    var collapsed: Bool? = nil
    var agentId: String? = nil
    var sectionId: String? = nil
    var beforeAgentId: String? = nil
    var direction: String? = nil

    enum CodingKeys: String, CodingKey {
        case action, id, name, collapsed, agentId, sectionId, beforeAgentId, direction
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(action, forKey: .action)
        if action == "reorder-section" {
            try values.encode(id, forKey: .id)
        } else {
            try values.encodeIfPresent(id, forKey: .id)
        }
        try values.encodeIfPresent(name, forKey: .name)
        try values.encodeIfPresent(collapsed, forKey: .collapsed)
        try values.encodeIfPresent(agentId, forKey: .agentId)
        if action == "move" {
            try values.encode(sectionId, forKey: .sectionId)
            try values.encode(beforeAgentId, forKey: .beforeAgentId)
        }
        try values.encodeIfPresent(direction, forKey: .direction)
    }
}

@MainActor @Observable final class AgentManagementModel {
    var navigation = AgentNavigation.empty
    var activity: [String: String] = [:]
    var error: String?
    var mutating = false
    private var refreshing = false
    private var mutationRevision = 0

    func refresh(api: RoostAPI) async {
        guard !refreshing, !mutating else { return }
        refreshing = true
        let revision = mutationRevision
        defer { refreshing = false }
        do {
            async let navigation: AgentNavigation = api.get("agent-navigation")
            async let activity: [String: String] = api.get("agent-activity")
            let values = try await (navigation, activity)
            try Task.checkCancellation()
            guard revision == mutationRevision else { return }
            self.navigation = values.0
            self.activity = values.1
            error = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {
        } catch { self.error = error.localizedDescription }
    }

    @discardableResult func change(_ change: AgentNavigationChange, api: RoostAPI) async -> Bool {
        guard !mutating else { return false }
        mutating = true
        mutationRevision += 1
        defer { mutating = false }
        do {
            let data = try await api.post("agent-navigation", change)
            navigation = try JSONDecoder().decode(AgentNavigation.self, from: data)
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}
