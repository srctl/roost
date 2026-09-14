import SwiftUI

struct ConnectView: View {
    @Environment(\.palette) private var palette

    @Bindable var app: AppModel
    @State private var server = ""
    @State private var token = ""
    @State private var connecting = false
    @State private var error: String?
    @State private var help = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    HStack(spacing: 2) {
                        CharacterView(name: "moss", size: 66)
                        CharacterView(name: "wisp", size: 56)
                        CharacterView(name: "peach", size: 56)
                    }
                    .padding(.top, 36)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Your Roost.\nWithin reach.")
                            .font(.largeTitle.weight(.semibold))
                        Text("Connect to your server to pick up with your agents.")
                            .font(.body)
                            .foregroundStyle(palette.muted)
                    }
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Server address")
                                .font(.subheadline.weight(.medium))
                            TextField("https://roost.example.com", text: $server)
                                .textContentType(.URL).keyboardType(.URL)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .accessibilityIdentifier("serverAddress")
                        }
                        Divider()
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Device token")
                                .font(.subheadline.weight(.medium))
                            SecureField("Paste your device token", text: $token)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .privacySensitive()
                                .accessibilityIdentifier("deviceToken")
                        }
                    }
                    .padding(20)
                    .background(palette.surface, in: RoundedRectangle(cornerRadius: 18))
                    if let error = error ?? app.error { ErrorNotice(text: error) }
                    Button {
                        connecting = true
                        Task {
                            defer { connecting = false }
                            do {
                                try await app.connect(server: server, token: token)
                                token = ""
                            } catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        HStack {
                            if connecting { ProgressView() }
                            Text(connecting ? "Connecting…" : "Connect to Roost")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(connecting || server.isEmpty || token.isEmpty)
                    .accessibilityIdentifier("connectButton")
                    Button("How to get a device token") { help = true }.font(.subheadline)
                }
                .padding(24)
                .frame(maxWidth: 560)
            }
            .themedScreen()
            .sheet(isPresented: $help) {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 20) {
                            Text("On your Roost server, create a token for this iPhone.")
                            Text("roost mobile create --name iPhone --output ~/iphone-token.txt")
                                .font(.system(.callout, design: .monospaced))
                                .textSelection(.enabled)
                            Text(
                                "Open that file and copy the token into the app. Keep it private and delete the transfer file afterward. Tokens expire after 90 days and can be revoked on the server."
                            )
                            Text(
                                "Your address must use HTTPS and allow the mobile API to connect directly. Browser-only sign-in proxies need a separate mobile endpoint."
                            )
                            .foregroundStyle(palette.muted)
                        }
                        .padding(24)
                    }
                    .themedScreen()
                    .navigationTitle("Connect your iPhone")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { Button("Done") { help = false } }
                }
                .presentationDetents([.medium, .large])
            }
        }
    }
}
