import SwiftUI

struct AgentIdentity: Decodable {
    struct Soul: Decodable {
        let content: String
        let revision: String
        let updatedAt: String
    }
    struct Memory: Decodable, Identifiable {
        let name: String
        let content: String
        var id: String { name }
    }
    struct Change: Decodable, Identifiable {
        let id: String
        let source: String
        let reason: String
        let before: String
        let after: String
        let afterRevision: String
        let createdAt: String
    }
    struct Reflection: Decodable {
        struct Run: Decodable {
            let id: String
            let status: String
            let error: String?
        }
        let intervalMinutes: Int
        let nextRunAt: Double?
        let latest: Run?
    }
    let soul: Soul
    let memories: [Memory]
    let changes: [Change]
    let reflection: Reflection
}

struct AgentIdentityView: View {
    @Environment(\.palette) private var palette
    let agent: Agent
    let api: RoostAPI
    @State private var identity: AgentIdentity?
    @State private var error: String?
    @State private var busy = false
    @State private var editingSoul = false
    @State private var reflectionInterval = 360
    @State private var reflectionRequestId = UUID().uuidString.lowercased()

    var body: some View {
        Form {
            if let error { Section { ErrorNotice(text: error) } }
            if let identity {
                Section {
                    NavigationLink {
                        ScrollView {
                            MarkdownText(text: identity.soul.content).padding()
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .themedScreen().navigationTitle("Soul")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { Button("Edit") { editingSoul = true } }
                    } label: {
                        Label("Soul", systemImage: "sparkles")
                    }
                    Button("Edit soul") { editingSoul = true }
                    NavigationLink {
                        history(identity)
                    } label: {
                        Label("Change history", systemImage: "clock.arrow.circlepath")
                    }
                } header: {
                    Text("Identity")
                } footer: {
                    Text(
                        "Your agent’s purpose, voice, judgment, and boundaries. Changes are saved with an undo history."
                    )
                }
                Section {
                    if identity.memories.isEmpty {
                        Text("Your agent will build memories as you work together.")
                            .foregroundStyle(palette.muted)
                    }
                    ForEach(identity.memories) { memory in
                        NavigationLink(
                            memory.name == "memory_summary.md" ? "Memory summary" : "Memories"
                        ) {
                            ScrollView {
                                MarkdownText(text: memory.content).padding()
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .themedScreen().navigationTitle("Memories")
                            .navigationBarTitleDisplayMode(.inline)
                        }
                    }
                } header: {
                    Text("Memory")
                } footer: {
                    Text(
                        "Roost manages these memories automatically. They stay separate from the agent’s soul."
                    )
                }
                Section {
                    Picker("Reflect", selection: $reflectionInterval) {
                        Text("Off").tag(0)
                        Text("Hourly").tag(60)
                        Text("Every 6 hours").tag(360)
                        Text("Daily").tag(1440)
                    }
                    .accessibilityIdentifier("agent-reflection-interval")
                    if reflectionInterval != identity.reflection.intervalMinutes {
                        Button("Save reflection schedule") { Task { await saveReflection() } }
                    }
                    if let latest = identity.reflection.latest {
                        LabeledContent("Last reflection", value: latest.status.capitalized)
                        if let error = latest.error, !error.isEmpty {
                            Text(error).font(.footnote).foregroundStyle(palette.muted)
                        }
                    }
                    Button("Reflect now", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await reflect() }
                    }
                } header: {
                    Text("Reflection")
                } footer: {
                    Text(
                        "Review recent conversations for meaningful lessons. Reflections may make small improvements to the soul; every change can be reviewed and undone."
                    )
                }
            } else if error == nil {
                ProgressView("Loading identity…")
            } else {
                Button("Retry") { Task { await load() } }
            }
        }
        .disabled(busy)
        .themedScreen()
        .navigationTitle("Identity & memory").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $editingSoul) {
            if let identity {
                AgentSoulEditor(api: api, agent: agent, soul: identity.soul) {
                    Task { await load() }
                }
            }
        }
    }

    private func history(_ identity: AgentIdentity) -> some View {
        List {
            if identity.changes.isEmpty {
                Text("No soul changes yet.").foregroundStyle(palette.muted)
            }
            ForEach(identity.changes) { change in
                DisclosureGroup {
                    Text("Before").font(.headline)
                    Text(change.before).font(.callout).textSelection(.enabled)
                    Text("After").font(.headline).padding(.top, 4)
                    Text(change.after).font(.callout).textSelection(.enabled)
                    if change.afterRevision == identity.soul.revision {
                        Button("Undo this change") { Task { await undo(change) } }.disabled(busy)
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(change.reason)
                        Text(change.source.capitalized).font(.caption)
                            .foregroundStyle(palette.muted)
                    }
                }
            }
            if let error { ErrorNotice(text: error) }
        }
        .themedScreen().navigationTitle("Soul history").navigationBarTitleDisplayMode(.inline)
    }

    private func load() async {
        do {
            let loaded: AgentIdentity = try await api.get("agents/\(agent.id)/identity")
            identity = loaded
            reflectionInterval = loaded.reflection.intervalMinutes
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    private func saveReflection() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await api.post(
                "agents/\(agent.id)/reflection", ["intervalMinutes": reflectionInterval])
            await load()
        } catch { self.error = error.localizedDescription }
    }

    private func reflect() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await api.post("agents/\(agent.id)/reflect", ["requestId": reflectionRequestId])
            reflectionRequestId = UUID().uuidString.lowercased()
            await load()
        } catch { self.error = error.localizedDescription }
    }

    private func undo(_ change: AgentIdentity.Change) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await api.post("agents/\(agent.id)/soul-undo", ["id": change.id])
            await load()
        } catch { self.error = error.localizedDescription }
    }
}

private struct AgentSoulEditor: View {
    @Environment(\.dismiss) private var dismiss
    let api: RoostAPI
    let agent: Agent
    @State private var soul: AgentIdentity.Soul
    let onSaved: () -> Void
    @State private var content: String
    @State private var error: String?
    @State private var saving = false
    @State private var discard = false
    @State private var reloadConfirmation = false

    init(api: RoostAPI, agent: Agent, soul: AgentIdentity.Soul, onSaved: @escaping () -> Void) {
        self.api = api
        self.agent = agent
        _soul = State(initialValue: soul)
        self.onSaved = onSaved
        _content = State(initialValue: soul.content)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error {
                    ErrorNotice(text: error)
                    Button("Reload latest soul") { reloadConfirmation = true }.padding(.bottom, 8)
                }
                TextEditor(text: $content).font(.body).padding(12)
                    .accessibilityIdentifier("agent-soul-editor")
            }
            .themedScreen().navigationTitle("Edit soul").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if content == soul.content { dismiss() } else { discard = true }
                    }
                    .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(
                            saving
                                || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                || content.count > 16000 || content == soul.content)
                }
            }
            .interactiveDismissDisabled(content != soul.content || saving)
            .confirmationDialog(
                "Discard soul changes?", isPresented: $discard, titleVisibility: .visible
            ) {
                Button("Discard changes", role: .destructive) { dismiss() }
            }
            .confirmationDialog(
                "Replace your edits with the latest saved soul?", isPresented: $reloadConfirmation,
                titleVisibility: .visible
            ) {
                Button("Discard and reload", role: .destructive) { Task { await reload() } }
            }
        }
    }

    private func reload() async {
        saving = true
        defer { saving = false }
        do {
            let identity: AgentIdentity = try await api.get("agents/\(agent.id)/identity")
            soul = identity.soul
            content = identity.soul.content
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await api.post(
                "agents/\(agent.id)/soul",
                [
                    "content": content, "revision": soul.revision,
                    "reason": "Edited in iPhone agent settings",
                ])
            onSaved()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
