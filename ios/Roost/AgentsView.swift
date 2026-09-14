import SwiftUI

struct AgentsView: View {
    @Environment(\.palette) private var palette
    @Bindable var app: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var search = ""
    @State private var settings = false
    @State private var selectedAgent: Agent?
    @Environment(\.roostReduceMotion) private var reduceMotion
    var filtered: [Agent] {
        app.agents.filter {
            search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)
                || $0.instructions.localizedCaseInsensitiveContains(search)
        }
    }

    var body: some View {
        Group {
            if let selectedAgent, let model = app.conversation(agent: selectedAgent) {
                AgentWorkspaceView(app: app, model: model) {
                    withAnimation(reduceMotion ? nil : RoostMotion.settle) {
                        self.selectedAgent = nil
                    }
                }
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                agentList
            }
        }
    }

    private var agentList: some View {
        NavigationStack {
            List {
                if let error = app.error { ErrorNotice(text: error).listRowSeparator(.hidden) }
                ForEach(filtered) { agent in
                    Button {
                        withAnimation(reduceMotion ? nil : RoostMotion.settle) {
                            selectedAgent = agent
                        }
                    } label: {
                        HStack(spacing: 16) {
                            CharacterView(name: agent.character, size: 48)
                            VStack(alignment: .leading, spacing: 5) {
                                Text(agent.name)
                                    .font(.headline)
                                Text(agent.instructions)
                                    .font(.subheadline)
                                    .foregroundStyle(palette.muted)
                                    .lineLimit(2)
                            }
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                                .foregroundStyle(palette.faint)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("agent-" + agent.name)
                    .listRowBackground(palette.background)
                    .listRowSeparatorTint(palette.border)
                }
            }
            .listStyle(.plain)
            .themedScreen()
            .overlay {
                if app.loading && app.agents.isEmpty {
                    ProgressView("Loading agents…")
                } else if app.agents.isEmpty && app.error == nil {
                    ContentUnavailableView(
                        "Your agents live here", systemImage: "bubble.left.and.bubble.right",
                        description: Text(
                            "Create an agent in Roost on the web, then pull down to refresh."))
                } else if filtered.isEmpty && !search.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .navigationTitle("Roost")
            .searchable(text: $search, prompt: "Find an agent")
            .refreshable { await app.refresh() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    await app.refresh()
                    do { try await Task.sleep(for: .seconds(15)) } catch { break }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        settings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $settings) { SettingsView(app: app) }
        }
    }
}
