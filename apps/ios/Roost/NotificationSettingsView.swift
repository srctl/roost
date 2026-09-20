import SwiftUI
import UIKit

struct NotificationPreferences: Codable, Equatable {
    var enabled: Bool
    var turnCompleted: Bool
    var agentUpdates: Bool
    var needsAttention: Bool
}

struct NotificationSettingsView: View {
    @Environment(\.palette) private var palette
    let api: RoostAPI
    @State private var preferences: NotificationPreferences?
    @State private var working = false
    @State private var error: String?
    @State private var notifications = AppNotifications.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Form {
            if let preferences {
                Section {
                    preference("Notifications", key: \.enabled)
                } footer: {
                    Text("These preferences apply to all devices connected to your Roost server.")
                }
                .listRowBackground(palette.surface)
                Section("Notify me about") {
                    preference("Completed responses", key: \.turnCompleted)
                    preference("Agent updates", key: \.agentUpdates)
                    preference("Approvals and failures", key: \.needsAttention)
                }
                .disabled(!preferences.enabled)
                .listRowBackground(palette.surface)
                Section("This iPhone") {
                    if notifications.working {
                        ProgressView("Updating notifications…")
                    } else {
                        Label(
                            notifications.enabled
                                ? "Enabled on this iPhone" : "Not enabled on this iPhone",
                            systemImage: notifications.enabled ? "bell.badge" : "bell.slash")
                    }
                    if let message = notifications.readinessMessage {
                        Text(message).font(.footnote).foregroundStyle(palette.muted)
                    }
                    if notifications.authorization == .denied {
                        Text("Roost notifications are turned off in iPhone Settings.")
                            .font(.footnote).foregroundStyle(palette.muted)
                        Link(
                            "Open iPhone notification settings",
                            destination: URL(string: UIApplication.openSettingsURLString)!)
                    } else if notifications.ready && !notifications.enabled {
                        Button("Enable on this iPhone") { Task { await notifications.enable() } }
                            .disabled(notifications.working)
                            .accessibilityIdentifier("enableNativePush")
                    }
                    if notifications.hasRequestedRegistration
                        || notifications.status?.registered == true
                    {
                        Button("Disable on this iPhone", role: .destructive) {
                            Task { await notifications.disable() }
                        }
                        .accessibilityIdentifier("disableNativePush")
                    }
                    if let failure = notifications.error { ErrorNotice(text: failure) }
                }
                .listRowBackground(palette.surface)
            } else if error == nil {
                ProgressView("Loading preferences…")
            }
            if let error {
                Section {
                    ErrorNotice(text: error)
                    Button("Try again") { Task { await load() } }
                }
            }
        }
        .disabled(working)
        .themedScreen()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
            await notifications.refresh()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await notifications.refresh() } }
        }
    }

    private func preference(_ title: String, key: WritableKeyPath<NotificationPreferences, Bool>)
        -> some View
    {
        Toggle(
            title,
            isOn: Binding(
                get: { preferences?[keyPath: key] ?? false },
                set: { value in
                    guard var updated = preferences else { return }
                    updated[keyPath: key] = value
                    Task { await save(updated) }
                }
            ))
    }

    private func load() async {
        do {
            preferences = try await api.get("settings/notifications")
            error = nil
        } catch is CancellationError {
        } catch { self.error = error.localizedDescription }
    }

    private func save(_ updated: NotificationPreferences) async {
        guard !working else { return }
        working = true
        defer { working = false }
        do {
            let data = try await api.post("settings/notifications", updated)
            preferences = try JSONDecoder().decode(NotificationPreferences.self, from: data)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
