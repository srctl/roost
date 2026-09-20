import CryptoKit
import Observation
import SwiftUI
import UIKit
import UserNotifications

struct NativePushStatus: Decodable {
    let configured: Bool
    let registered: Bool
    let environment: String?
    let bundleId: String?
    let registrationId: String?
}

struct RoostPushPayload: Equatable, Sendable {
    let agentId: String
    let conversationId: String?
    let registrationId: String

    init?(userInfo: [AnyHashable: Any]) {
        guard let agentId = userInfo["agentId"] as? String, UUID(uuidString: agentId) != nil,
            let registrationId = userInfo["registrationId"] as? String,
            UUID(uuidString: registrationId) != nil
        else { return nil }
        self.agentId = agentId
        self.registrationId = registrationId
        self.conversationId = (userInfo["conversationId"] as? String)
            .flatMap { UUID(uuidString: $0) == nil ? nil : $0 }
    }
}

struct SavedPushRegistration: Codable, Equatable {
    let connectionFingerprint: String
    let registrationId: String

    static func fingerprint(_ connection: Connection) -> String {
        let origin = connection.server.absoluteString.trimmingCharacters(
            in: CharacterSet(charactersIn: "/"))
        return SHA256.hash(data: Data((origin + "\n" + connection.token).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    func matches(_ payload: RoostPushPayload, connection: Connection, status: NativePushStatus)
        -> Bool
    {
        connectionFingerprint == Self.fingerprint(connection)
            && status.configured && status.registered
            && registrationId == payload.registrationId
            && status.registrationId == payload.registrationId
    }
}

// Keep server-side mutations ordered even when a view task is cancelled. A
// disable or server switch must remove a registration after every earlier POST
// settles, including a POST whose response was lost or no longer applies locally.
@MainActor final class PushRegistrationWrites {
    private var tail: Task<Data, Error>?
    private var sequence = 0

    func enqueue(_ operation: @escaping @MainActor () async throws -> Data) -> Task<Data, Error> {
        let previous = tail
        sequence += 1
        let current = sequence
        let task = Task { @MainActor in
            if let previous { _ = await previous.result }
            defer { if sequence == current { tail = nil } }
            return try await operation()
        }
        tail = task
        return task
    }
}

@MainActor @Observable final class AppNotifications {
    static let shared = AppNotifications()
    private static let savedKey = "roost.native-push.registration"
    private static let intentKey = "roost.native-push.enabled-connection"
    var status: NativePushStatus?
    var authorization: UNAuthorizationStatus = .notDetermined
    var error: String?
    var working = false
    var pendingAgentId: String?
    private(set) var pendingConversationId: String?
    private var connection: Connection?
    private var saved: SavedPushRegistration?
    private var deviceToken: String?
    private var pendingPayload: RoostPushPayload?
    private var generation = 0
    private var wantsRegistration = false
    private let writes = PushRegistrationWrites()
    private var registrationTimeout: Task<Void, Never>?
    var hasRequestedRegistration: Bool { wantsRegistration }

    var buildEnvironment: String? {
        guard
            let value = Bundle.main.object(forInfoDictionaryKey: "RoostAPNSEnvironment") as? String,
            ["sandbox", "production"].contains(value)
        else { return nil }
        return value
    }
    var permissionGranted: Bool {
        authorization == .authorized || authorization == .provisional || authorization == .ephemeral
    }
    var enabled: Bool {
        wantsRegistration && status?.registered == true
            && saved?.registrationId == status?.registrationId && permissionGranted
    }
    var ready: Bool {
        guard let status, let environment = buildEnvironment else { return false }
        return status.configured && status.environment == environment
            && status.bundleId == Bundle.main.bundleIdentifier
    }
    var readinessMessage: String? {
        guard buildEnvironment != nil else {
            return
                "This build needs the Push Notifications capability. Install a signed build configured for APNs to enable iPhone notifications."
        }
        guard let status else { return nil }
        if !status.configured {
            return
                "Your Roost server needs its Apple push notification configuration before this iPhone can receive notifications."
        }
        if !ready {
            return
                "This app’s bundle identifier or APNs environment does not match the server configuration."
        }
        return nil
    }

    private init() {}

    func configure(connection next: Connection?) async {
        guard connection != next else {
            await refresh()
            return
        }
        let old = connection
        let previouslyEnabled = wantsRegistration || saved != nil
        generation += 1
        registrationTimeout?.cancel()
        let current = generation
        connection = next
        deviceToken = nil
        status = nil
        saved = nil
        wantsRegistration = false
        working = false
        error = nil
        pendingAgentId = nil
        pendingConversationId = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        if let old, previouslyEnabled {
            let removal = writes.enqueue {
                try await RoostAPI(connection: old).request("notifications/push", method: "DELETE")
            }
            _ = try? await removal.value
        }
        guard current == generation else { return }
        guard let next else {
            UserDefaults.standard.removeObject(forKey: Self.savedKey)
            UserDefaults.standard.removeObject(forKey: Self.intentKey)
            pendingPayload = nil
            return
        }
        let fingerprint = SavedPushRegistration.fingerprint(next)
        if let data = UserDefaults.standard.data(forKey: Self.savedKey),
            let stored = try? JSONDecoder().decode(SavedPushRegistration.self, from: data),
            stored.connectionFingerprint == fingerprint
        {
            saved = stored
        } else {
            UserDefaults.standard.removeObject(forKey: Self.savedKey)
        }
        wantsRegistration = UserDefaults.standard.string(forKey: Self.intentKey) == fingerprint
        if !wantsRegistration { UserDefaults.standard.removeObject(forKey: Self.intentKey) }
        await refresh()
        guard current == generation else { return }
        // Refresh an already-enabled registration without asking for permission.
        if wantsRegistration && permissionGranted && ready {
            UIApplication.shared.registerForRemoteNotifications()
        }
        if let pendingPayload { await received(pendingPayload) }
    }

    func refresh() async {
        guard !working else { return }
        let current = generation
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard current == generation else { return }
        authorization = settings.authorizationStatus
        guard let connection else { return }
        do {
            let response: NativePushStatus = try await RoostAPI(connection: connection)
                .get("notifications/push")
            guard current == generation else { return }
            status = response
            error = nil
        } catch is CancellationError {} catch {
            if current == generation { self.error = error.localizedDescription }
        }
    }

    // Only this explicit settings action can ask iOS for notification permission.
    func enable() async {
        guard !working, let connection, ready else { return }
        working = true
        error = nil
        generation += 1
        let current = generation
        do {
            let granted = try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .badge, .sound])
            guard current == generation else { return }
            authorization = await UNUserNotificationCenter.current().notificationSettings()
                .authorizationStatus
            guard current == generation else { return }
            guard granted else {
                working = false
                error =
                    "Notifications are turned off for Roost. Enable them in iPhone Settings to continue."
                return
            }
            wantsRegistration = true
            UserDefaults.standard.set(
                SavedPushRegistration.fingerprint(connection), forKey: Self.intentKey)
            UIApplication.shared.registerForRemoteNotifications()
            registrationTimeout?.cancel()
            registrationTimeout = Task { @MainActor in
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
                guard current == generation, working else { return }
                working = false
                error =
                    "Apple did not finish registering this iPhone. Check your connection and try again."
            }
            // didRegister completes the authenticated server registration. Never
            // call this enabled before the server acknowledges that registration.
        } catch {
            guard current == generation else { return }
            working = false
            self.error = error.localizedDescription
        }
    }

    func registered(deviceToken data: Data) async {
        guard wantsRegistration, let connection, let environment = buildEnvironment, ready else {
            return
        }
        generation += 1
        let current = generation
        registrationTimeout?.cancel()
        let token = data.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        working = true
        defer {
            if current == generation {
                working = false
                registrationTimeout?.cancel()
            }
        }
        do {
            let input = [
                "deviceToken": token, "bundleId": Bundle.main.bundleIdentifier ?? "",
                "environment": environment,
            ]
            let registration = writes.enqueue {
                try await RoostAPI(connection: connection).post("notifications/push", input)
            }
            let data = try await registration.value
            let response = try JSONDecoder().decode(NativePushStatus.self, from: data)
            guard current == generation, wantsRegistration, deviceToken == token else { return }
            guard response.registered, let id = response.registrationId else {
                throw APIError(
                    message:
                        "The server did not confirm this iPhone’s registration. Try enabling notifications again."
                )
            }
            status = response
            saved = SavedPushRegistration(
                connectionFingerprint: SavedPushRegistration.fingerprint(connection),
                registrationId: id)
            UserDefaults.standard.set(try JSONEncoder().encode(saved), forKey: Self.savedKey)
            error = nil
        } catch { if current == generation { self.error = error.localizedDescription } }
    }

    func registrationFailed(_ message: String) {
        guard wantsRegistration else { return }
        working = false
        registrationTimeout?.cancel()
        error = "Could not register this iPhone with Apple. " + message
    }

    func disable() async {
        guard let connection else { return }
        generation += 1
        registrationTimeout?.cancel()
        let current = generation
        working = true
        wantsRegistration = false
        deviceToken = nil
        saved = nil
        pendingPayload = nil
        pendingAgentId = nil
        pendingConversationId = nil
        UserDefaults.standard.removeObject(forKey: Self.savedKey)
        UserDefaults.standard.removeObject(forKey: Self.intentKey)
        UIApplication.shared.unregisterForRemoteNotifications()
        defer {
            if current == generation {
                working = false
                registrationTimeout?.cancel()
            }
        }
        do {
            let removal = writes.enqueue {
                try await RoostAPI(connection: connection)
                    .request("notifications/push", method: "DELETE")
            }
            let data = try await removal.value
            let response = try JSONDecoder().decode(NativePushStatus.self, from: data)
            guard current == generation else { return }
            status = response
            error = nil
        } catch {
            if current == generation {
                self.error =
                    "Could not remove this iPhone’s server registration. Try disabling again. "
                    + error.localizedDescription
            }
        }
    }

    func accepts(_ payload: RoostPushPayload) async -> Bool {
        guard let connection, let saved, wantsRegistration else { return false }
        let current = generation
        do {
            let live: NativePushStatus = try await RoostAPI(connection: connection)
                .get("notifications/push")
            guard current == generation else { return false }
            return saved.matches(payload, connection: connection, status: live)
        } catch { return false }
    }

    func received(_ payload: RoostPushPayload) async {
        guard connection != nil else {
            pendingPayload = payload
            return
        }
        pendingPayload = nil
        guard await accepts(payload) else { return }
        pendingConversationId = payload.conversationId
        pendingAgentId = payload.agentId
    }

    func takePendingAgentID() -> String? {
        let id = pendingAgentId
        pendingAgentId = nil
        pendingConversationId = nil
        return id
    }
}

final class RoostNotificationDelegate: NSObject, UIApplicationDelegate,
    UNUserNotificationCenterDelegate
{
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in await AppNotifications.shared.registered(deviceToken: deviceToken) }
    }
    func application(
        _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in AppNotifications.shared.registrationFailed(error.localizedDescription)
        }
    }
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let payload = RoostPushPayload(userInfo: response.notification.request.content.userInfo)
        Task { @MainActor in
            if let payload { await AppNotifications.shared.received(payload) }
            completionHandler()
        }
    }
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) ->
            Void
    ) {
        let payload = RoostPushPayload(userInfo: notification.request.content.userInfo)
        Task { @MainActor in
            let accepted =
                if let payload { await AppNotifications.shared.accepts(payload) } else { false }
            // Keep foreground notifications in Notification Center quietly.
            completionHandler(accepted ? [.list] : [])
        }
    }
}
