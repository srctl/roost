import SwiftUI

struct AgentCodingConfiguration: Decodable {
    let settings: AgentCodingSettings
    let profiles: [AgentExecutionProfile]
}

struct AgentTaskSource: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var databaseUrl: String
    var filter: String
    var instructions: String
}

struct AgentCodingSettings: Codable, Equatable {
    let agentId: String
    var repository: String
    var projectInstructions: String
    var defaultProfileId: String?
    var sources: [AgentTaskSource]
    var revision: Int
    enum CodingKeys: String, CodingKey {
        case agentId, repository, projectInstructions, defaultProfileId, sources, revision
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(agentId, forKey: .agentId)
        try values.encode(repository, forKey: .repository)
        try values.encode(projectInstructions, forKey: .projectInstructions)
        try values.encode(defaultProfileId, forKey: .defaultProfileId)
        try values.encode(sources, forKey: .sources)
        try values.encode(revision, forKey: .revision)
    }
}

struct AgentExecutionProfile: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var kind: String
    var target: String
    var instructions: String
    var revision: Int
}

struct AgentCodingSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    let agent: Agent
    let api: RoostAPI
    @State private var settings: AgentCodingSettings
    @State private var saved: AgentCodingSettings?
    @State private var profiles: [AgentExecutionProfile] = []
    @State private var editProfile: AgentExecutionProfile?
    @State private var editSource: AgentTaskSource?
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @State private var reloadConfirmation = false
    @State private var discardConfirmation = false

    private var hasChanges: Bool { saved != nil && settings != saved }

    init(agent: Agent, api: RoostAPI) {
        self.agent = agent
        self.api = api
        _settings = State(
            initialValue: AgentCodingSettings(
                agentId: agent.id, repository: "", projectInstructions: "", defaultProfileId: nil,
                sources: [], revision: 0))
    }

    var body: some View {
        Form {
            if let error { Section { ErrorNotice(text: error) } }
            if loading {
                ProgressView("Loading project settings…")
            } else if saved != nil {
                Section {
                    TextField("Repository URL or path", text: $settings.repository)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityLabel("Repository URL or path")
                        .accessibilityIdentifier("coding-repository")
                    TextField(
                        "Project instructions", text: $settings.projectInstructions, axis: .vertical
                    )
                    .lineLimit(4...10)
                    .accessibilityLabel("Project instructions")
                    .accessibilityIdentifier("coding-project-instructions")
                    Picker("Default execution", selection: $settings.defaultProfileId) {
                        Text("Choose per job").tag(String?.none)
                        ForEach(profiles) { profile in Text(profile.name).tag(Optional(profile.id))
                        }
                    }
                } header: {
                    Text("Project")
                } footer: {
                    Text("Repository and instructions are provided to each new coding job.")
                }
                Section {
                    ForEach(settings.sources) { source in
                        Button {
                            editSource = source
                        } label: {
                            HStack {
                                Text(source.name)
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { settings.sources.remove(atOffsets: $0) }
                    if settings.sources.count < 50 {
                        Button("Add task source", systemImage: "plus") {
                            editSource = AgentTaskSource(
                                id: UUID().uuidString.lowercased(), name: "", databaseUrl: "",
                                filter: "", instructions: "")
                        }
                    }
                } header: {
                    Text("Task sources")
                } footer: {
                    Text(
                        "Connect source locations and describe which tasks your agent should pick up."
                    )
                }
                Section {
                    ForEach(profiles) { profile in
                        Button {
                            editProfile = profile
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(profile.name)
                                    Text(profile.kind == "ssh" ? profile.target : "Local execution")
                                        .font(.caption).foregroundStyle(palette.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("execution-profile-\(profile.id)")
                    }
                    Button("Add execution profile", systemImage: "plus") {
                        editProfile = AgentExecutionProfile(
                            id: UUID().uuidString.lowercased(), name: "", kind: "local", target: "",
                            instructions: "", revision: 0)
                    }
                } header: {
                    Text("Execution profiles")
                } footer: {
                    Text(
                        "Profiles are shared by all coding agents. Editing a profile saves it immediately."
                    )
                }
                if settings != saved {
                    Section { Button("Save project settings") { Task { await save() } }.bold() }
                }
            } else {
                Button("Retry") { Task { await load() } }
            }
        }
        .themedScreen().disabled(saving)
        .navigationTitle("Coding project").navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(hasChanges)
        .toolbar {
            if hasChanges {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back", systemImage: "chevron.left") { discardConfirmation = true }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }.bold().disabled(saving)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Reload", systemImage: "arrow.clockwise") {
                    if saved != nil && settings != saved {
                        reloadConfirmation = true
                    } else {
                        Task { await load() }
                    }
                }
                .disabled(saving || loading)
            }
        }
        .confirmationDialog(
            "Discard unsaved project changes and reload?", isPresented: $reloadConfirmation,
            titleVisibility: .visible
        ) {
            Button("Discard and reload", role: .destructive) { Task { await load() } }
        }
        .confirmationDialog(
            "Discard unsaved project changes?", isPresented: $discardConfirmation,
            titleVisibility: .visible
        ) {
            Button("Discard changes", role: .destructive) { dismiss() }
        }
        .task { if saved == nil { await load() } }
        .sheet(item: $editProfile) { profile in
            AgentExecutionProfileEditor(api: api, profile: profile) {
                Task { await refreshProfiles() }
            }
        }
        .sheet(item: $editSource) { source in
            AgentTaskSourceEditor(source: source) { updated in
                if let index = settings.sources.firstIndex(where: { $0.id == updated.id }) {
                    settings.sources[index] = updated
                } else {
                    settings.sources.append(updated)
                }
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let response: AgentCodingConfiguration = try await api.get(
                "agents/\(agent.id)/coding-settings")
            settings = response.settings
            saved = response.settings
            profiles = response.profiles
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    private func refreshProfiles() async {
        do {
            profiles = try await api.get("execution-profiles")
            // Removing a default profile revises every affected coding settings row.
            // Only reload the project when it has no local edits; otherwise keep its
            // old revision so any concurrent server edit produces a save conflict.
            if settings == saved { await load() }
            if let id = settings.defaultProfileId, !profiles.contains(where: { $0.id == id }) {
                settings.defaultProfileId = nil
            }
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let data = try await api.post("agents/\(agent.id)/coding-settings", settings)
            settings = try JSONDecoder().decode(AgentCodingSettings.self, from: data)
            saved = settings
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

private struct AgentExecutionProfileEditor: View {
    @Environment(\.dismiss) private var dismiss
    let api: RoostAPI
    @State var profile: AgentExecutionProfile
    let onSaved: () -> Void
    @State private var saving = false
    @State private var error: String?
    @State private var deleting = false

    var body: some View {
        NavigationStack {
            Form {
                if let error { Section { ErrorNotice(text: error) } }
                Section {
                    TextField("Profile name", text: $profile.name)
                        .accessibilityLabel("Profile name")
                        .accessibilityIdentifier("execution-profile-name")
                    Picker("Execution", selection: $profile.kind) {
                        Text("Local").tag("local")
                        Text("SSH").tag("ssh")
                    }
                    if profile.kind == "ssh" {
                        TextField("Host alias or user@hostname", text: $profile.target)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    TextField(
                        "Execution instructions", text: $profile.instructions, axis: .vertical
                    )
                    .lineLimit(3...8)
                    .accessibilityLabel("Execution instructions")
                    .accessibilityIdentifier("execution-profile-instructions")
                }
                if profile.revision > 0 {
                    Section { Button("Delete profile", role: .destructive) { deleting = true } }
                }
            }
            .themedScreen().disabled(saving)
            .navigationTitle(profile.revision == 0 ? "New profile" : "Execution profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(
                            saving
                                || profile.name.trimmingCharacters(in: .whitespacesAndNewlines)
                                    .isEmpty
                                || profile.name.count > 160 || profile.instructions.count > 32000
                                || profile.target.count > 4000)
                }
            }
            .interactiveDismissDisabled(saving)
            .confirmationDialog(
                "Delete this shared execution profile? Agents using it will choose execution per job.",
                isPresented: $deleting, titleVisibility: .visible
            ) {
                Button("Delete profile", role: .destructive) { Task { await remove() } }
            }
        }
    }
    private func save() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await api.post("execution-profiles", profile)
            onSaved()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
    private func remove() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await api.request(
                "execution-profiles/\(profile.id)", method: "DELETE",
                body: JSONEncoder().encode(["revision": profile.revision]))
            onSaved()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

private struct AgentTaskSourceEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State var source: AgentTaskSource
    let onSaved: (AgentTaskSource) -> Void
    var body: some View {
        NavigationStack {
            Form {
                TextField("Source name", text: $source.name)
                TextField("Source URL or location", text: $source.databaseUrl)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField(
                    "Which tasks should the agent select?", text: $source.filter, axis: .vertical
                )
                .lineLimit(3...8)
                TextField("Source instructions", text: $source.instructions, axis: .vertical)
                    .lineLimit(3...8)
            }
            .themedScreen().navigationTitle("Task source").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onSaved(source)
                        dismiss()
                    }
                    .disabled(
                        source.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || source.name.count > 160 || source.databaseUrl.count > 4000
                            || source.filter.count > 32000 || source.instructions.count > 32000)
                }
            }
        }
    }
}
