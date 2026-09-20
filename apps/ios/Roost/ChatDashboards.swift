import Observation
import SwiftUI

/// One store per agent and connection. Message rows only borrow models, so a
/// repeated card or a recycled lazy row keeps the same draft and retry identity.
@MainActor final class ChatDashboardStore {
    private let transport: (String) -> DashboardTransport
    private let now: () -> Date
    private var models: [String: JuxiDashboardModel] = [:]
    private var visible: [String: Set<String>] = [:]
    private var refreshed: [String: Date] = [:]
    private var refreshing: Set<String> = []
    private var active = true

    init(api: RoostAPI, agentId: String) {
        transport = { DashboardTransport(api: api, agentId: agentId, chatKey: $0) }
        now = Date.init
    }

    init(transport: @escaping (String) -> DashboardTransport, now: @escaping () -> Date = Date.init)
    {
        self.transport = transport
        self.now = now
    }

    func model(for key: String) -> JuxiDashboardModel {
        if let existing = models[key] { return existing }
        let model = JuxiDashboardModel(transport: transport(key))
        if !active { model.invalidate() }
        models[key] = model
        return model
    }

    func show(_ key: String, occurrence: String) {
        visible[key, default: []].insert(occurrence)
    }

    func hide(_ key: String, occurrence: String) {
        visible[key]?.remove(occurrence)
        if visible[key]?.isEmpty == true { visible[key] = nil }
    }

    func refreshVisible(force: Bool = false) async {
        for key in visible.keys.sorted() { await refresh(key, force: force) }
    }

    func refresh(_ key: String, force: Bool = false) async {
        guard active, !refreshing.contains(key),
            force || refreshed[key].map({ now().timeIntervalSince($0) >= 3 }) != false
        else { return }
        refreshing.insert(key)
        defer { refreshing.remove(key) }
        await model(for: key).refresh()
        if !Task.isCancelled { refreshed[key] = now() }
    }

    func invalidate() {
        active = false
        for model in models.values { model.invalidate() }
        visible = [:]
    }
}

struct DashboardCardContext {
    var inline = false
    var occurrence = ""
    func identifier(_ base: String) -> String {
        occurrence.isEmpty ? base : base + "-" + occurrence
    }
}
private struct DashboardCardContextKey: EnvironmentKey {
    static let defaultValue = DashboardCardContext()
}
extension EnvironmentValues {
    var dashboardCardContext: DashboardCardContext {
        get { self[DashboardCardContextKey.self] }
        set { self[DashboardCardContextKey.self] = newValue }
    }
}

@MainActor struct InlineDashboardCard: View {
    @Environment(\.palette) private var palette
    let store: ChatDashboardStore
    let key: String
    let occurrence: String
    private var model: JuxiDashboardModel { store.model(for: key) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let snapshot = model.snapshot {
                if snapshot.enabled && !snapshot.widgets.isEmpty {
                    JuxiDashboardContent(snapshot: snapshot, discuss: { _ in })
                        .environment(model)
                        .environment(
                            \.dashboardCardContext,
                            DashboardCardContext(inline: true, occurrence: occurrence))
                } else {
                    placeholder(
                        snapshot.presentation?.notice ?? "This tracker is no longer available.")
                }
            } else if model.error == nil {
                ProgressView("Loading tracker…").padding()
            }
            if let error = model.error {
                ErrorNotice(text: error)
                Button("Retry tracker") { Task { await store.refresh(key, force: true) } }
                    .accessibilityIdentifier("retry-tracker-\(occurrence)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task {
            store.show(key, occurrence: occurrence)
            await store.refresh(key)
        }
        .onDisappear { store.hide(key, occurrence: occurrence) }
    }

    private func placeholder(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "rectangle.slash")
                .font(.subheadline).foregroundStyle(palette.muted)
            Button("Check again") { Task { await store.refresh(key, force: true) } }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 20))
    }
}
