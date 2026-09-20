import SwiftUI

@main struct RoostApp: App {
    @UIApplicationDelegateAdaptor(RoostNotificationDelegate.self) private var notificationsDelegate
    @State private var app = AppModel()
    @AppStorage("appearance") private var appearance = "system"

    var body: some Scene {
        WindowGroup {
            ThemeRoot {
                if app.connection != nil {
                    AgentsView(app: app).id(app.sessionID)
                } else {
                    ConnectView(app: app)
                }
            }
            .preferredColorScheme(
                appearance == "system" ? nil : appearance == "dark" ? .dark : .light
            )
            .task(id: app.sessionID) {
                await AppNotifications.shared.configure(connection: app.connection)
            }
        }
    }
}
