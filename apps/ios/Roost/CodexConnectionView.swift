import SwiftUI
import UIKit

struct CodexLoginState: Decodable {
    let status: String
    let loginId: String?
    let verificationUrl: String?
    let userCode: String?
    let error: String?
    static let idle = CodexLoginState(
        status: "idle", loginId: nil, verificationUrl: nil, userCode: nil, error: nil)

    var signInURL: URL? {
        guard let verificationUrl, let url = URL(string: verificationUrl),
            url.scheme?.lowercased() == "https", url.host?.lowercased() == "auth.openai.com",
            url.user == nil, url.password == nil, url.port == nil || url.port == 443
        else { return nil }
        return url
    }
}

struct CodexAccountState: Decodable {
    let configured: Bool
    let login: CodexLoginState
}

@MainActor @Observable final class CodexConnectionModel {
    let api: RoostAPI
    var configured = false
    var login = CodexLoginState.idle
    var loading = false
    var busy = false
    var error: String?
    private var revision = 0
    init(api: RoostAPI) { self.api = api }

    func load() async {
        guard !loading, !busy else { return }
        loading = true
        let before = revision
        defer { loading = false }
        do {
            let result: CodexAccountState = try await api.get("account")
            try Task.checkCancellation()
            guard before == revision else { return }
            configured = result.configured
            login = result.login
            error = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {
        } catch { self.error = error.localizedDescription }
    }

    func poll() async {
        guard !busy else { return }
        let before = revision
        do {
            let next: CodexLoginState = try await api.get("account/login")
            try Task.checkCancellation()
            guard before == revision else { return }
            login = next
            if next.status == "connected" { configured = true }
            error = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {
        } catch { self.error = error.localizedDescription }
    }

    func start() async {
        guard !busy else { return }
        busy = true
        revision += 1
        defer { busy = false }
        do {
            let data = try await api.post("account/login", [String: String]())
            login = try JSONDecoder().decode(CodexLoginState.self, from: data)
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    func cancel() async {
        guard !busy, let loginId = login.loginId else { return }
        busy = true
        revision += 1
        defer { busy = false }
        do {
            let data = try await api.request(
                "account/login", method: "DELETE", body: JSONEncoder().encode(["loginId": loginId]))
            login = try JSONDecoder().decode(CodexLoginState.self, from: data)
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

struct CodexConnectionView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.palette) private var palette
    @State private var model: CodexConnectionModel
    @State private var copied = false

    init(api: RoostAPI) { _model = State(initialValue: CodexConnectionModel(api: api)) }

    var body: some View {
        Form {
            Section {
                if model.loading {
                    ProgressView("Checking Codex connection…")
                } else {
                    Label(
                        model.login.status == "connected"
                            ? "Connected"
                            : model.configured ? "Saved Codex login" : "Not connected",
                        systemImage: model.configured || model.login.status == "connected"
                            ? "checkmark.circle" : "person.crop.circle.badge.questionmark")
                    Text(
                        model.configured
                            ? "This server has a saved Codex login. Reconnect if your agents ask you to sign in again."
                            : "Sign in with ChatGPT to let your agents use Codex on this server."
                    )
                    .font(.subheadline).foregroundStyle(palette.muted)
                }
                if model.login.status != "pending" {
                    Button(model.configured ? "Reconnect Codex" : "Connect Codex") {
                        copied = false
                        Task { await model.start() }
                    }
                    .disabled(model.loading || model.busy).accessibilityIdentifier("connectCodex")
                }
            } header: {
                Text("Codex connection")
            } footer: {
                Text(
                    "Applies to all agents on this Roost server. OpenAI handles sign-in; credentials stay on the server."
                )
            }
            if model.login.status == "pending" {
                Section {
                    if let code = model.login.userCode {
                        LabeledContent("One-time code") {
                            Text(code).font(.title3.monospaced().bold()).textSelection(.enabled)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("One-time code")
                        .accessibilityValue(code)
                        .accessibilityIdentifier("codexDeviceCode")
                        Button(copied ? "Code copied" : "Copy code", systemImage: "doc.on.doc") {
                            UIPasteboard.general.string = code
                            copied = true
                        }
                    }
                    if let url = model.login.signInURL {
                        Link("Open ChatGPT sign-in", destination: url)
                    } else {
                        ErrorNotice(
                            text:
                                "The server returned an unsupported sign-in address. Cancel and try again."
                        )
                    }
                    Label("Waiting for sign-in…", systemImage: "clock")
                        .font(.subheadline).foregroundStyle(palette.muted)
                    Button("Cancel sign-in", role: .cancel) { Task { await model.cancel() } }
                        .disabled(model.busy)
                } header: {
                    Text("Finish sign-in")
                } footer: {
                    Text(
                        "Copy the code, open ChatGPT sign-in, and enter it there. Return here when you’re done."
                    )
                }
            }
            if let error = model.error ?? model.login.error { Section { ErrorNotice(text: error) } }
            Section {
                Link(
                    "Manage browser passkeys & sessions",
                    destination: model.api.connection.server.appendingPathComponent("auth"))
            } footer: {
                Text(
                    "Browser security settings open in your browser and require their own sign-in.")
            }
        }
        .themedScreen()
        .navigationTitle("Codex & security").navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load() }
        .task(id: scenePhase) { if scenePhase == .active { await model.load() } }
        .task(id: scenePhase == .active && model.login.status == "pending") {
            guard scenePhase == .active && model.login.status == "pending" else { return }
            while !Task.isCancelled && model.login.status == "pending" {
                do { try await Task.sleep(for: .seconds(2)) } catch { break }
                await model.poll()
            }
        }
    }
}
