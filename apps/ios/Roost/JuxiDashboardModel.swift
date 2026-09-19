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
        case .summary: ["metrics", "markdown"].contains(block.type)
        case .charts: ["chart", "dataset-chart"].contains(block.type)
        case .tables: block.type == "table"
        case .tasks: block.type == "tasks"
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

    init(api: RoostAPI, agentId: String) {
        let path = "agents/\(agentId)/dashboard"
        load = { try await api.get(path) }
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
    }

    init(
        load: @escaping () async throws -> DashboardSnapshot,
        present: @escaping (DashboardPresentationRequest) async throws -> DashboardPresentation,
        enable: @escaping () async throws -> Void = {}
    ) {
        self.load = load
        self.present = present
        self.enable = enable
    }
}

@MainActor @Observable final class JuxiDashboardModel {
    private(set) var snapshot: DashboardSnapshot?
    private(set) var error: String?
    private(set) var updating = false
    var intentDraft = ""
    private let transport: DashboardTransport
    private var generation = 0
    private var refreshID = 0
    private var loadedIntent = false

    init(transport: DashboardTransport) { self.transport = transport }

    func refresh() async {
        guard !updating else { return }
        await load()
    }

    @discardableResult private func load(clearError: Bool = true) async -> Bool {
        refreshID += 1
        let request = refreshID
        let generation = self.generation
        do {
            var incoming = try await transport.load()
            guard !Task.isCancelled, generation == self.generation, request == refreshID else {
                return false
            }
            // A delayed replica or refresh must never replace a newer confirmed selection.
            if let existing = snapshot?.presentation,
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
        guard !updating, let presentation = snapshot?.presentation else { return }
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
            guard !Task.isCancelled else { return }
            if result.revision >= (snapshot?.presentation?.revision ?? -1) {
                snapshot?.presentation = result
                if replacesDraft && intentDraft == submittedDraft { intentDraft = result.intent }
            }
        } catch let failure as APIError where failure.status == 409 {
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

    func enable() async {
        guard !updating else { return }
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
