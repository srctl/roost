import SwiftUI

struct FeedPreferencesView: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let model: FeedModel
    let app: AppModel
    @State var settings: FeedSettings
    @State private var apiKey = ""
    @State private var saving = false
    @State private var error: String?
    @State private var conflict = false
    @State private var addingSource = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Enable feed", isOn: $settings.enabled)
                        .accessibilityIdentifier("feedEnabled")
                    Picker("Check sources", selection: $settings.refreshMinutes) {
                        Text("Every 30 minutes").tag(30)
                        Text("Hourly").tag(60)
                        Text("Every 3 hours").tag(180)
                        Text("Every 6 hours").tag(360)
                        Text("Daily").tag(1440)
                        if ![30, 60, 180, 360, 1440].contains(settings.refreshMinutes) {
                            Text("Every \(settings.refreshMinutes) minutes")
                                .tag(settings.refreshMinutes)
                        }
                    }
                } footer: {
                    Text(
                        "Your shared feed keeps updating on the server while this iPhone is closed."
                    )
                }
                .listRowBackground(palette.surface)

                Section("Your interests") {
                    TextField(
                        "Topics, places, and things you enjoy", text: $settings.interests,
                        axis: .vertical
                    )
                    .lineLimit(4...8).accessibilityIdentifier("feedInterests")
                }
                .listRowBackground(palette.surface)

                Section("What matters right now") {
                    TextField(
                        "Projects, plans, and priorities", text: $settings.priorities,
                        axis: .vertical
                    )
                    .lineLimit(3...6).accessibilityIdentifier("feedPriorities")
                }
                .listRowBackground(palette.surface)

                Section {
                    ForEach($settings.sources) { $source in
                        NavigationLink {
                            FeedSourceEditor(source: $source)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(source.name)
                                Text(source.enabled ? source.url : "Paused")
                                    .font(.caption).foregroundStyle(palette.muted).lineLimit(1)
                            }
                        }
                    }
                    .onDelete { settings.sources.remove(atOffsets: $0) }
                    Button("Add source", systemImage: "plus") { addingSource = true }
                        .accessibilityIdentifier("feedAddSource")
                        .disabled(settings.sources.count >= 20)
                } header: {
                    Text("Publications")
                } footer: {
                    Text(
                        "Add an RSS or Atom feed. Articles link back to their original publication. Swipe a source to remove it."
                    )
                }
                .listRowBackground(palette.surface)

                Section {
                    Picker("Contributing agent", selection: $settings.agentId) {
                        Text("Publications only").tag(String?.none)
                        ForEach(app.agents) { agent in
                            Text(agent.name).tag(Optional(agent.id))
                        }
                        if let selected = settings.agentId,
                            !app.agents.contains(where: { $0.id == selected })
                        {
                            Text("Unavailable agent").tag(Optional(selected))
                        }
                    }
                    Toggle("Include important email updates", isOn: $settings.emailEnabled)
                        .disabled(settings.agentId == nil)
                } header: {
                    Text("Stories and personal updates")
                } footer: {
                    Text(
                        "A contributing agent can write stories and surface important updates using its connected sources. Email updates require email access for that agent; this setting does not connect an inbox."
                    )
                }
                .listRowBackground(palette.surface)

                Section {
                    Toggle("Use Jev for personal scores", isOn: $settings.jevEnabled)
                    SecureField(
                        settings.jevKeySource == "environment"
                            ? "API key managed on server"
                            : settings.jevConfigured ? "Replace saved API key" : "TypeSafe API key",
                        text: $apiKey
                    )
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .privacySensitive().accessibilityIdentifier("feedJevKey")
                    .disabled(settings.jevKeySource == "environment")
                    if settings.jevConfigured {
                        Label(
                            settings.jevKeySource == "environment"
                                ? "Key configured on server" : "Key saved on server",
                            systemImage: "checkmark.circle"
                        )
                        .font(.footnote).foregroundStyle(palette.muted)
                    }
                    Toggle(
                        "Allow private updates to be scored", isOn: $settings.scorePrivateUpdates
                    )
                    .disabled(!settings.jevEnabled)
                } header: {
                    Text("Relevance")
                } footer: {
                    Text(
                        "Jev uses your existing interests, priorities, and feed feedback to estimate practical usefulness and how much you would enjoy each story. Article excerpts and this profile are sent to TypeSafe. See both scores in the story reader. Allowing private scoring also sends personal update excerpts; it is off by default. Without Jev, the feed uses basic selection."
                    )
                }
                .listRowBackground(palette.surface)
                if let error {
                    Section {
                        ErrorNotice(text: error)
                        if conflict {
                            Button("Reload saved preferences") {
                                Task {
                                    await model.load()
                                    if model.error == nil, let latest = model.settings {
                                        settings = latest
                                        self.error = nil
                                        conflict = false
                                    } else {
                                        self.error = model.error
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .themedScreen().textCase(nil)
            .navigationTitle("Feed preferences").navigationBarTitleDisplayMode(.inline)
            .disabled(saving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { save() }
                        .fontWeight(.semibold).disabled(saving)
                        .accessibilityIdentifier("feedSavePreferences")
                }
            }
            .interactiveDismissDisabled(saving)
            .sheet(isPresented: $addingSource) {
                AddFeedSourceView { source in settings.sources.append(source) }
            }
            .task { await app.refresh() }
        }
    }

    private func save() {
        guard
            settings.sources.allSatisfy({
                !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    && workspaceURL($0.url) != nil
            })
        else {
            error = "Each publication needs a name and a valid HTTP or HTTPS feed address."
            return
        }
        saving = true
        Task {
            defer { saving = false }
            do {
                if settings.agentId == nil { settings.emailEnabled = false }
                try await model.saveSettings(settings, apiKey: apiKey)
                apiKey = ""
                dismiss()
                await model.load()
            } catch {
                self.error = error.localizedDescription
                conflict = (error as? APIError)?.status == 409
            }
        }
    }
}

private struct FeedSourceEditor: View {
    @Environment(\.palette) private var palette
    @Binding var source: FeedSource

    var body: some View {
        Form {
            Section {
                TextField("Publication name", text: $source.name)
                TextField("RSS or Atom feed URL", text: $source.url, axis: .vertical)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                Toggle("Follow this source", isOn: $source.enabled)
            }
            .listRowBackground(palette.surface)
        }
        .themedScreen().navigationTitle("Publication").navigationBarTitleDisplayMode(.inline)
    }
}

private struct AddFeedSourceView: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let add: (FeedSource) -> Void
    @State private var name = ""
    @State private var url = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Publication name", text: $name)
                        .accessibilityIdentifier("feedSourceName")
                    TextField("RSS or Atom feed URL", text: $url, axis: .vertical)
                        .keyboardType(.URL).textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("feedSourceURL")
                }
                .listRowBackground(palette.surface)
            }
            .themedScreen().navigationTitle("Add publication")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        add(
                            FeedSource(
                                id: UUID().uuidString,
                                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                                url: url.trimmingCharacters(in: .whitespacesAndNewlines),
                                enabled: true))
                        dismiss()
                    }
                    .disabled(
                        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || workspaceURL(url.trimmingCharacters(in: .whitespacesAndNewlines))
                                == nil
                    )
                }
            }
        }
    }
}
