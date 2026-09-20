import SwiftUI

private enum AgentListSheet: Identifiable {
    case create
    case rename(Agent)
    case delete(Agent)
    case newSection(String)
    case renameSection(AgentSection)
    var id: String {
        switch self {
        case .create: "create"
        case .rename(let agent): "rename-" + agent.id
        case .delete(let agent): "delete-" + agent.id
        case .newSection(let id): "new-section-" + id
        case .renameSection(let section): "section-" + section.id
        }
    }
}

struct AgentsView: View {
    @Environment(\.palette) private var palette
    @Bindable var app: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.roostReduceMotion) private var reduceMotion
    @State private var search = ""
    @State private var settings = false
    @State private var adding = false
    @State private var surface = "agents"
    @State private var selectedAgent: Agent?
    @State private var selectedConversationID: String?
    @State private var sheet: AgentListSheet?
    @State private var management = AgentManagementModel()

    private var filtered: [Agent] {
        management.navigation.ordered(app.agents)
            .filter {
                search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)
                    || $0.instructions.localizedCaseInsensitiveContains(search)
            }
    }

    var body: some View {
        Group {
            if let selectedAgent,
                let model = app.conversation(agent: selectedAgent, id: selectedConversationID)
            {
                AgentWorkspaceView(app: app, model: model) {
                    withAnimation(reduceMotion ? nil : RoostMotion.settle) {
                        self.selectedAgent = nil
                        selectedConversationID = nil
                    }
                }
                .id(model.conversationId)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                TabView(selection: $surface) {
                    if let api = app.api {
                        FeedView(app: app, api: api)
                            .tabItem { Label("Feed", systemImage: "newspaper") }
                            .tag("feed")
                    }
                    agentList
                        .tabItem { Label("Agents", systemImage: "bubble.left.and.bubble.right") }
                        .tag("agents")
                }
                .tint(palette.accent)
            }
        }
        .task(id: AppNotifications.shared.pendingAgentId) {
            let notifications = AppNotifications.shared
            guard let id = notifications.pendingAgentId else { return }
            let session = app.sessionID
            if !app.agents.contains(where: { $0.id == id }) { await app.refresh() }
            guard !Task.isCancelled, app.sessionID == session,
                notifications.pendingAgentId == id,
                let agent = app.agents.first(where: { $0.id == id })
            else { return }
            selectedConversationID = notifications.pendingConversationId
            settings = false
            adding = false
            sheet = nil
            surface = "agents"
            selectedAgent = agent
            _ = notifications.takePendingAgentID()
        }
    }

    private var agentList: some View {
        NavigationStack {
            List {
                if let error = app.error ?? management.error {
                    ErrorNotice(text: error).listRowSeparator(.hidden)
                }
                ForEach(groupIDs, id: \.self) { id in
                    let section = management.navigation.sections.first { $0.id == id }
                    let agents = agents(in: section?.id)
                    if search.isEmpty || !agents.isEmpty {
                        Section {
                            if section?.collapsed != true || !search.isEmpty {
                                ForEach(agents) { agent in agentRow(agent) }
                                    .onMove { source, destination in
                                        moveAgent(
                                            source, destination: destination, agents: agents,
                                            section: section?.id)
                                    }
                                if agents.isEmpty && section != nil {
                                    Text("Move agents here from their menu.")
                                        .font(.subheadline).foregroundStyle(palette.muted)
                                        .listRowBackground(palette.background)
                                }
                            }
                        } header: {
                            if !management.navigation.sections.isEmpty { sectionHeader(section) }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .themedScreen()
            .overlay {
                if app.loading && app.agents.isEmpty {
                    ProgressView("Loading agents…")
                } else if app.agents.isEmpty && app.error == nil {
                    ContentUnavailableView {
                        Label("Your agents live here", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Create a teammate with a purpose of its own.")
                    } actions: {
                        Button("Create an agent") { sheet = .create }
                            .buttonStyle(.borderedProminent)
                    }
                } else if filtered.isEmpty && !search.isEmpty {
                    ContentUnavailableView.search(text: search)
                }
            }
            .navigationTitle("Roost")
            .searchable(text: $search, prompt: "Find an agent")
            .refreshable { await refresh() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    await refresh()
                    do { try await Task.sleep(for: .seconds(15)) } catch { break }
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        settings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if app.agents.count > 1 && search.isEmpty {
                        EditButton().disabled(management.mutating)
                    }
                    Button {
                        adding = true
                    } label: {
                        Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Add agent or section")
                }
            }
            .confirmationDialog("Add to Roost", isPresented: $adding, titleVisibility: .visible) {
                Button("New agent") { sheet = .create }
                Button("New section") { sheet = .newSection(UUID().uuidString.lowercased()) }
            }
            .sheet(isPresented: $settings) { SettingsView(app: app) }
            .sheet(item: $sheet) { item in
                if let api = app.api { sheetContent(item, api: api) }
            }
        }
    }

    private var groupIDs: [String] {
        var ids = management.navigation.sections.sorted { $0.position < $1.position }.map(\.id)
        ids.insert("ungrouped", at: min(max(0, management.navigation.ungroupedPosition), ids.count))
        return ids
    }

    private func agents(in section: String?) -> [Agent] {
        filtered.filter { agent in
            let membership = management.navigation.memberships[agent.id]
            let valid = management.navigation.sections.contains { $0.id == membership }
            return (valid ? membership : nil) == section
        }
    }

    private func agentRow(_ agent: Agent) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : RoostMotion.settle) { selectedAgent = agent }
        } label: {
            HStack(spacing: 14) {
                CharacterView(name: agent.character, size: 46)
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(agent.name).font(.headline)
                        if agent.kind == "coding" {
                            Image(systemName: "chevron.left.forwardslash.chevron.right")
                                .font(.caption).foregroundStyle(palette.muted)
                                .accessibilityLabel("Coding agent")
                        }
                    }
                    if let status = management.activity[agent.id] {
                        Label(
                            activityLabel(status),
                            systemImage: status == "approval" ? "hand.raised" : "circle.fill"
                        )
                        .font(.caption.weight(.medium))
                        .foregroundStyle(status == "approval" ? .orange : palette.accent)
                    } else {
                        Text(agent.instructions).font(.subheadline).foregroundStyle(palette.muted)
                            .lineLimit(2)
                    }
                }
                .padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                    .foregroundStyle(palette.faint)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("agent-" + agent.name)
        .listRowBackground(palette.background).listRowSeparatorTint(palette.border)
        .contextMenu {
            Button("Rename", systemImage: "pencil") { sheet = .rename(agent) }
            Menu("Move to section", systemImage: "folder") {
                Button("Agents") { change(.init(action: "move", agentId: agent.id)) }
                ForEach(management.navigation.sections) { section in
                    Button(section.name) {
                        change(.init(action: "move", agentId: agent.id, sectionId: section.id))
                    }
                }
            }
            Button("Delete agent", systemImage: "trash", role: .destructive) {
                sheet = .delete(agent)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            // This action presents confirmation; it does not delete the row.
            // A destructive swipe role makes List remove it optimistically,
            // conflicting with the later removal after the server confirms.
            Button("Delete", systemImage: "trash") { sheet = .delete(agent) }.tint(.red)
            Button("Rename", systemImage: "pencil") { sheet = .rename(agent) }.tint(palette.accent)
        }
    }

    private func sectionHeader(_ section: AgentSection?) -> some View {
        HStack {
            if let section {
                Button {
                    change(.init(action: "collapse", id: section.id, collapsed: !section.collapsed))
                } label: {
                    Label(
                        section.name,
                        systemImage: section.collapsed ? "chevron.right" : "chevron.down")
                }
                .buttonStyle(.plain)
                .accessibilityLabel((section.collapsed ? "Expand " : "Collapse ") + section.name)
            } else {
                Text("Agents")
            }
            Spacer()
            Menu {
                if let section {
                    Button("Rename section", systemImage: "pencil") {
                        sheet = .renameSection(section)
                    }
                }
                Button("Move up", systemImage: "arrow.up") {
                    change(.init(action: "reorder-section", id: section?.id, direction: "up"))
                }
                Button("Move down", systemImage: "arrow.down") {
                    change(.init(action: "reorder-section", id: section?.id, direction: "down"))
                }
                if let section {
                    Button("Remove section", systemImage: "folder.badge.minus") {
                        change(.init(action: "delete", id: section.id))
                    }
                }
            } label: {
                Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 36)
            }
            .accessibilityLabel("Options for " + (section?.name ?? "Agents"))
            .disabled(management.mutating)
        }
        .textCase(nil).foregroundStyle(palette.muted)
    }

    @ViewBuilder private func sheetContent(_ item: AgentListSheet, api: RoostAPI) -> some View {
        switch item {
        case .create:
            AgentCreationView(api: api) { agent in
                if !app.agents.contains(where: { $0.id == agent.id }) { app.agents.append(agent) }
                selectedAgent = agent
            }
        case .rename(let agent):
            AgentNameEditor(
                title: "Rename agent",
                save: { name in
                    _ = try await api.post("agents/\(agent.id)/name", ["name": name])
                    await app.refresh()
                }, name: agent.name)
        case .delete(let agent):
            AgentDeletionView(agent: agent, api: api) { app.agents.removeAll { $0.id == agent.id } }
        case .newSection(let id):
            AgentNameEditor(
                title: "New section",
                save: { name in
                    let changed = await management.change(
                        .init(action: "create", id: id, name: name),
                        api: api)
                    if !changed {
                        throw APIError(message: management.error ?? "Could not create the section.")
                    }
                }, name: "")
        case .renameSection(let section):
            AgentNameEditor(
                title: "Rename section",
                save: { name in
                    let changed = await management.change(
                        .init(action: "rename", id: section.id, name: name), api: api)
                    if !changed {
                        throw APIError(message: management.error ?? "Could not rename the section.")
                    }
                }, name: section.name)
        }
    }

    private func activityLabel(_ status: String) -> String {
        switch status {
        case "working": "Working"
        case "queued": "Queued"
        case "delegating": "Working with a teammate"
        case "approval": "Needs your attention"
        default: status.capitalized
        }
    }

    private func refresh() async {
        guard let api = app.api else { return }
        async let agents: Void = app.refresh()
        async let navigation: Void = management.refresh(api: api)
        _ = await (agents, navigation)
    }

    private func change(_ change: AgentNavigationChange) {
        guard let api = app.api else { return }
        Task { await management.change(change, api: api) }
    }

    private func moveAgent(_ source: IndexSet, destination: Int, agents: [Agent], section: String?)
    {
        guard source.count == 1, let index = source.first else { return }
        let moving = agents[index]
        var reordered = agents
        reordered.move(fromOffsets: source, toOffset: destination)
        guard let nextIndex = reordered.firstIndex(where: { $0.id == moving.id }) else { return }
        let before = nextIndex + 1 < reordered.count ? reordered[nextIndex + 1].id : nil
        change(.init(action: "move", agentId: moving.id, sectionId: section, beforeAgentId: before))
    }
}
