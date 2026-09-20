import SwiftUI

struct AgentCreationView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    let api: RoostAPI
    let onCreated: (Agent) -> Void
    @State private var name = ""
    @State private var instructions = ""
    @State private var character = "moss"
    @State private var kind = "assistant"
    @State private var model = ""
    @State private var options: AgentOptions?
    @State private var loading = false
    @State private var saving = false
    @State private var error: String?
    @State private var attempt: AgentCreation?

    private var valid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && name.count <= 60
            && !instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && instructions.count <= 8000 && !model.isEmpty && options != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Section { ErrorNotice(text: error) } }
                Section {
                    TextField("Agent name", text: $name)
                        .textInputAutocapitalization(.words)
                        .accessibilityIdentifier("new-agent-name")
                    Picker("Type", selection: $kind) {
                        Text("Assistant").tag("assistant")
                        Text("Coding agent").tag("coding")
                    }
                    TextField(
                        "What should your agent help with?", text: $instructions, axis: .vertical
                    )
                    .lineLimit(4...10)
                    .accessibilityIdentifier("new-agent-instructions")
                } header: {
                    Text("Your agent")
                } footer: {
                    Text(
                        kind == "coding"
                            ? "A teammate for your project. Configure its repository and execution profiles in agent settings after creating it."
                            : "Give your agent a purpose and any instructions it should follow.")
                }
                if let options {
                    Section("Character") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(options.characters, id: \.self) { value in
                                    Button {
                                        character = value
                                    } label: {
                                        VStack(spacing: 6) {
                                            CharacterView(name: value, size: 40)
                                            Text(value.capitalized).font(.caption)
                                        }
                                        .frame(width: 66).padding(.vertical, 10)
                                        .background(
                                            character == value
                                                ? palette.accent.opacity(0.12) : .clear,
                                            in: RoundedRectangle(cornerRadius: 12)
                                        )
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 12)
                                                .stroke(
                                                    character == value ? palette.accent : .clear,
                                                    lineWidth: 2)
                                        )
                                        .contentShape(RoundedRectangle(cornerRadius: 12))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(value.capitalized + " character")
                                    .accessibilityAddTraits(character == value ? .isSelected : [])
                                }
                            }
                            .padding(2)
                        }
                    }
                    Section {
                        Picker("Model", selection: $model) {
                            ForEach(options.models) { model in
                                Text(model.displayName).tag(model.model)
                            }
                        }
                        .pickerStyle(.navigationLink)
                    } footer: {
                        Text("Creating an agent saves its workspace. It won’t start a task.")
                    }
                } else {
                    Section {
                        if loading {
                            ProgressView("Loading available models…")
                        } else {
                            Button("Retry loading models") { Task { await loadOptions() } }
                        }
                    }
                }
            }
            .disabled(saving)
            .themedScreen()
            .navigationTitle("New agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await create() }
                    } label: {
                        if saving { ProgressView() } else { Text("Create").bold() }
                    }
                    .disabled(!valid || saving)
                    .accessibilityIdentifier("create-agent")
                }
            }
            .interactiveDismissDisabled(saving)
            .task { await loadOptions() }
        }
    }

    private func loadOptions() async {
        loading = true
        defer { loading = false }
        do {
            let loaded: AgentOptions = try await api.get("agent-options")
            options = loaded
            if !loaded.models.contains(where: { $0.model == model }) {
                model =
                    (loaded.models.first(where: \.isDefault) ?? loaded.models.first)?.model ?? ""
            }
            error = nil
        } catch is CancellationError {} catch { self.error = error.localizedDescription }
    }

    private func create() async {
        guard valid, !saving else { return }
        saving = true
        defer { saving = false }
        var input = AgentCreation(
            id: attempt?.id ?? UUID().uuidString.lowercased(),
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            instructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines),
            character: character, model: model, kind: kind)
        if let attempt, attempt != input { input.id = UUID().uuidString.lowercased() }
        attempt = input
        do {
            let data = try await api.post("agents", input)
            let agent = try JSONDecoder().decode(Agent.self, from: data)
            onCreated(agent)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct AgentNameEditor: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let save: (String) async throws -> Void
    @State var name: String
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name).textInputAutocapitalization(.words)
                        .accessibilityIdentifier("agent-name-editor")
                    if let error { ErrorNotice(text: error) }
                }
            }
            .themedScreen()
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            saving = true
                            defer { saving = false }
                            do {
                                try await save(name.trimmingCharacters(in: .whitespacesAndNewlines))
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }
                    .disabled(
                        saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || name.count > 60)
                }
            }
            .disabled(saving).interactiveDismissDisabled(saving)
        }
        .presentationDetents([.medium, .large])
    }
}

struct AgentDeletionView: View {
    @Environment(\.dismiss) private var dismiss
    let agent: Agent
    let api: RoostAPI
    let onDeleted: () -> Void
    @State private var confirmation = ""
    @State private var deleting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(
                        "Deleting \(agent.name) removes its conversations, notes, dashboard, automations, and settings from Roost. This cannot be undone."
                    )
                    TextField("Type \(agent.name) to confirm", text: $confirmation)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("delete-agent-confirmation")
                    if let error { ErrorNotice(text: error) }
                    Button(role: .destructive) {
                        Task { await remove() }
                    } label: {
                        if deleting { ProgressView() } else { Text("Delete agent") }
                    }
                    .disabled(confirmation != agent.name || deleting)
                    .accessibilityIdentifier("confirm-delete-agent")
                }
            }
            .themedScreen()
            .navigationTitle("Delete agent?").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(deleting)
                }
            }
            .disabled(deleting).interactiveDismissDisabled(deleting)
        }
        .presentationDetents([.medium, .large])
    }

    private func remove() async {
        guard confirmation == agent.name, !deleting else { return }
        deleting = true
        defer { deleting = false }
        do {
            _ = try await api.request(
                "agents/\(agent.id)", method: "DELETE",
                body: JSONEncoder().encode(["name": agent.name]))
            onDeleted()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
