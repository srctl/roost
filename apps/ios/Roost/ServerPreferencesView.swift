import SwiftUI

struct ServerPreferencesView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("showActivityDetails") private var showActivityDetails = false
    let api: RoostAPI
    @State private var dashboards: Bool?
    @State private var working = false
    @State private var loading = false
    @State private var error: String?

    private struct Preference: Codable { let enabled: Bool }

    var body: some View {
        Form {
            Section {
                Toggle("Show activity details", isOn: $showActivityDetails)
                    .accessibilityIdentifier("showActivityDetails")
            } header: {
                Text("On this iPhone")
            } footer: {
                Text(
                    "In Codex format, expand tool inputs, outputs, and thought summaries. Messages format keeps activity hidden."
                )
            }
            .listRowBackground(palette.surface)

            Section {
                if let dashboards {
                    Toggle(
                        "Dashboards",
                        isOn: Binding(
                            get: { self.dashboards ?? dashboards },
                            set: { enabled in Task { await saveDashboards(enabled) } }
                        )
                    )
                    .disabled(loading || working)
                    .accessibilityIdentifier("dashboardsEnabled")
                } else if loading {
                    ProgressView("Loading dashboard setting…")
                }
                if let error {
                    ErrorNotice(text: error)
                    Button("Try again") { Task { await loadDashboards() } }
                        .disabled(loading || working)
                }
            } header: {
                Text("Across your devices")
            } footer: {
                Text(
                    "Dashboards keep trackers, project updates, and trends with each agent. Turning this off stops dashboard updates across Roost; saved content stays available when you turn it back on."
                )
            }
            .listRowBackground(palette.surface)
        }
        .themedScreen().textCase(nil)
        .navigationTitle("Display preferences").navigationBarTitleDisplayMode(.inline)
        .refreshable { await loadDashboards() }
        .task(id: scenePhase) {
            if scenePhase == .active { await loadDashboards() }
        }
    }

    private func loadDashboards() async {
        guard !loading, !working else { return }
        loading = true
        defer { loading = false }
        do {
            let preference: Preference = try await api.get("settings/dashboards")
            guard !Task.isCancelled else { return }
            dashboards = preference.enabled
            error = nil
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func saveDashboards(_ enabled: Bool) async {
        guard !working, !loading else { return }
        working = true
        defer { working = false }
        do {
            let data = try await api.post("settings/dashboards", Preference(enabled: enabled))
            dashboards = try JSONDecoder().decode(Preference.self, from: data).enabled
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
