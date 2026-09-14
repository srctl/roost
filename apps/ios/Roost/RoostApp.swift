import SwiftUI

@main struct RoostApp: App {
    @State private var app = AppModel()
    @AppStorage("appearance") private var appearance = "system"

    var body: some Scene {
        WindowGroup {
            ThemeRoot {
                if app.connection != nil { AgentsView(app: app) } else { ConnectView(app: app) }
            }
            .preferredColorScheme(
                appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
        }
    }
}
