import SwiftUI

struct SettingsView: View {
    @Environment(\.palette) private var palette
    @Bindable var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("responseStyle") private var responseStyle: ResponseStyle = .messages
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("themePreset") private var preset: ThemePreset = .default
    @State private var error: String?
    @State private var working = false
    @State private var confirm = false
    @State private var reconnect = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    Text(app.connection?.server.absoluteString ?? "")
                        .textSelection(.enabled)
                    Text("Your agents keep working on this server when the app is closed.")
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                }
                .listRowBackground(palette.surface)
                if let api = app.api {
                    Section {
                        NavigationLink {
                            CodexConnectionView(api: api)
                        } label: {
                            Label("Codex & security", systemImage: "person.crop.circle")
                        }
                        .accessibilityIdentifier("codexConnectionSettings")
                        NavigationLink {
                            NotificationSettingsView(api: api)
                        } label: {
                            Label("Notifications", systemImage: "bell")
                        }
                        .accessibilityIdentifier("notificationSettings")
                        NavigationLink {
                            PaymentsView(api: api)
                        } label: {
                            Label("Payments", systemImage: "creditcard")
                        }
                        .accessibilityIdentifier("paymentsSettings")
                    }
                    .listRowBackground(palette.surface)
                }
                Section("Appearance") {
                    if let api = app.api {
                        NavigationLink {
                            ServerPreferencesView(api: api)
                        } label: {
                            Text("Display preferences")
                        }
                        .accessibilityIdentifier("displayPreferences")
                    }
                    NavigationLink {
                        ThemePickerView()
                    } label: {
                        LabeledContent("Color theme", value: preset.name)
                    }
                    .accessibilityIdentifier("colorThemePicker")
                    Picker("Appearance", selection: $appearance) {
                        Text("System").tag("system")
                        Text("Light").tag("light")
                        Text("Dark").tag("dark")
                    }
                }
                .listRowBackground(palette.surface)
                Section("Responses") {
                    Picker("Format", selection: $responseStyle) {
                        Text("Messages").tag(ResponseStyle.messages)
                        Text("Codex").tag(ResponseStyle.codex)
                    }
                    .accessibilityIdentifier("responseStylePicker")
                    Text(
                        responseStyle == .messages
                            ? "Chat bubbles with tool activity hidden."
                            : "Open responses with tool activity in the conversation."
                    )
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                }
                .listRowBackground(palette.surface)
                Section {
                    Button("Reconnect with a new token") { reconnect = true }
                        .disabled(working)
                    Button("Disconnect this iPhone", role: .destructive) { confirm = true }
                        .disabled(working)
                    Button("Remove saved connection only") { disconnect(revoke: false) }
                        .disabled(working)
                } footer: {
                    Text(
                        "Disconnect revokes this device token. Removing only the saved connection is available when the server cannot be reached."
                    )
                }
                .listRowBackground(palette.surface)
                if let error { ErrorNotice(text: error) }
            }
            .themedScreen()
            .textCase(nil)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() }.disabled(working) }
            .interactiveDismissDisabled(working)
            .confirmationDialog(
                "Disconnect this iPhone?", isPresented: $confirm, titleVisibility: .visible
            ) {
                Button("Revoke token and disconnect", role: .destructive) {
                    disconnect(revoke: true)
                }
            }
            .sheet(isPresented: $reconnect) {
                ConnectView(app: app, serverAddress: app.connection?.server.absoluteString ?? "") {
                    reconnect = false
                }
                .onChange(of: app.connection) { _, _ in reconnect = false }
            }
        }
        .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
    }

    private func disconnect(revoke: Bool) {
        working = true
        Task {
            defer { working = false }
            do {
                try await app.disconnect(revoke: revoke)
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
