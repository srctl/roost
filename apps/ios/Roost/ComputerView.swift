import SwiftUI
import WebKit

@MainActor private final class DesktopMessageHandler: NSObject, WKScriptMessageHandler {
    weak var model: ComputerModel?
    init(_ model: ComputerModel) { self.model = model }
    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        model?.userContentController(userContentController, didReceive: message)
    }
}

@MainActor
final class ComputerModel: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate
{
    @Published var connected = false
    @Published var controlling = false
    @Published var working = false
    @Published var error: String?
    @Published var enabled: Bool?
    let api: RoostAPI
    @Published private(set) var webView: WKWebView
    private var ticket: String?
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var receiver: Task<Void, Never>?
    private var renewal: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var generation = UUID().uuidString
    private var active = false
    private var processRecoveries = 0

    init(api: RoostAPI) {
        self.api = api
        webView = Self.makeWebView()
        super.init()
        configure(webView)
    }

    private static func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        return webView
    }

    private func configure(_ webView: WKWebView) {
        webView.configuration.userContentController.add(
            DesktopMessageHandler(self), name: "desktop")
        webView.navigationDelegate = self
    }

    private func replaceWebView() {
        webView.navigationDelegate = nil
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "desktop")
        let replacement = Self.makeWebView()
        configure(replacement)
        webView = replacement
    }

    func start(resetRecovery: Bool = true) async {
        stop()
        if resetRecovery { processRecoveries = 0 }
        let attempt = generation
        active = true
        working = true
        error = nil
        enabled = nil
        do {
            struct Status: Decodable { let enabled: Bool }
            let status: Status = try await api.get("computer")
            guard active, generation == attempt, !Task.isCancelled else { return }
            enabled = status.enabled
            guard status.enabled else {
                working = false
                return
            }
            guard let url = Bundle.main.url(forResource: "DesktopViewer", withExtension: "js")
            else {
                throw APIError(message: "The desktop viewer is missing. Reinstall the app.")
            }
            let script = try String(contentsOf: url, encoding: .utf8)
            let html = """
                <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:"><style>html,body,#screen{margin:0;width:100%;height:100%;overflow:hidden;background:#111311;touch-action:none}</style></head><body><div id="screen"></div><script>window.roostGeneration='\(attempt)';\(script)</script></body></html>
                """
            // A UIViewRepresentable may be rebuilt during scene transitions.
            // Reusing its old WKWebView can leave that view detached while its
            // RFB session still reports connected. Each connection owns a fresh
            // renderer and SwiftUI identity, including after process termination.
            replaceWebView()
            webView.loadHTMLString(html, baseURL: nil)
            timeout = Task {
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
                if generation == attempt && active && !connected {
                    fail("The desktop didn’t respond. Reconnect to try again.")
                }
            }
        } catch is CancellationError {
            if generation == attempt { working = false }
        } catch { if generation == attempt { fail(error.localizedDescription) } }
    }

    func stop() {
        let previous = generation
        active = false
        generation = UUID().uuidString
        connected = false
        controlling = false
        working = false
        receiver?.cancel()
        renewal?.cancel()
        timeout?.cancel()
        receiver = nil
        renewal = nil
        socket?.cancel(with: .goingAway, reason: nil)
        session?.invalidateAndCancel()
        socket = nil
        session = nil
        ticket = nil
        webView.stopLoading()
        webView.evaluateJavaScript(
            "if (window.roostGeneration === '\(previous)') { window.roostControl?.(false) }"
        ) { _, _ in }
    }

    private func connect(attempt: String) async {
        do {
            let data = try await api.post("computer/viewer", [String: String]())
            let result = try JSONDecoder().decode(IDResponse.self, from: data)
            guard active, generation == attempt else { return }
            ticket = result.id
            var components = URLComponents(
                url: api.connection.server.appendingPathComponent("api/mobile/v1/computer/socket"),
                resolvingAgainstBaseURL: false)!
            components.scheme = components.scheme == "https" ? "wss" : "ws"
            components.queryItems = [URLQueryItem(name: "ticket", value: result.id)]
            var request = URLRequest(url: components.url!)
            request.setValue("Bearer " + api.connection.token, forHTTPHeaderField: "Authorization")
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpShouldSetCookies = false
            configuration.httpCookieAcceptPolicy = .never
            configuration.timeoutIntervalForRequest = 15
            let session = URLSession(
                configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
            self.session = session
            let socket = session.webSocketTask(with: request)
            socket.maximumMessageSize = 16 * 1024 * 1024
            self.socket = socket
            socket.resume()
            receiver = Task {
                do {
                    while !Task.isCancelled {
                        let message = try await socket.receive()
                        guard active, generation == attempt, !Task.isCancelled else { return }
                        if case .data(let bytes) = message {
                            try await webView.evaluateJavaScript(
                                "window.roostReceive('\(bytes.base64EncodedString())')")
                        }
                    }
                } catch {
                    if active && generation == attempt && !Task.isCancelled {
                        fail("Desktop disconnected. Reconnect to continue.")
                    }
                }
            }
        } catch { if active && generation == attempt { fail(error.localizedDescription) } }
    }

    func setControl(_ value: Bool) async {
        guard let ticket, connected, !working else { return }
        let attempt = generation
        working = true
        defer { if generation == attempt { working = false } }
        do {
            try await webView.evaluateJavaScript(
                "if (window.roostGeneration === '\(attempt)') { window.roostControl(false) }")
            guard active, generation == attempt else { return }
            struct Control: Encodable {
                let id: String
                let control: Bool
            }
            struct Result: Decodable { let controlling: Bool }
            let data = try await api.post("computer/control", Control(id: ticket, control: value))
            let result = try JSONDecoder().decode(Result.self, from: data)
            guard active, generation == attempt else { return }
            controlling = result.controlling
            try await webView.evaluateJavaScript(
                "if (window.roostGeneration === '\(attempt)') { window.roostControl(\(result.controlling)) }"
            )
            guard active, generation == attempt else { return }
            error = nil
            renewal?.cancel()
            if controlling {
                renewal = Task {
                    do { try await Task.sleep(for: .seconds(8)) } catch { return }
                    guard !Task.isCancelled, active, controlling else { return }
                    await setControl(true)
                }
            }
        } catch {
            guard generation == attempt else { return }
            controlling = false
            self.error = error.localizedDescription
        }
    }

    func sendText(_ text: String) async -> Bool {
        guard controlling, connected else { return false }
        let attempt = generation
        // callAsyncJavaScript passes strings as arguments without interpolation.
        do {
            let sent = try await webView.callAsyncJavaScript(
                "return window.roostText(text)", arguments: ["text": text], in: nil,
                contentWorld: .page)
            return generation == attempt && sent as? Bool == true
        } catch {
            if generation == attempt {
                self.error = "Could not send this text. Your text is still here."
            }
            return false
        }
    }

    func sendKey(_ key: Int) async {
        guard controlling else { return }
        _ = try? await webView.evaluateJavaScript("window.roostKey(\(key))")
    }

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard active, message.webView === webView, message.frameInfo.isMainFrame,
            let body = message.body as? [String: Any], body["generation"] as? String == generation,
            let type = body["type"] as? String
        else { return }
        let attempt = generation
        switch type {
        case "ready": Task { await connect(attempt: attempt) }
        case "connected":
            connected = true
            working = false
            timeout?.cancel()
        case "send":
            if let value = body["value"] as? String, let bytes = Data(base64Encoded: value),
                bytes.count <= 1024 * 1024
            {
                // Preserve RFB packet order; URLSession enqueues each callback send.
                socket?
                    .send(.data(bytes)) { [weak self] error in
                        if error != nil {
                            Task { @MainActor in
                                guard self?.generation == attempt else { return }
                                self?.fail("Could not send desktop input. Reconnect to continue.")
                            }
                        }
                    }
            }
        case "failure": fail("The desktop rejected the connection. Check its VNC configuration.")
        case "disconnected", "close": fail("Desktop disconnected. Reconnect to continue.")
        default: break
        }
    }

    private func fail(_ message: String) {
        stop()
        error = message
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(navigationAction.request.url?.scheme == "about" ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard webView === self.webView, active else { return }
        guard processRecoveries < 1, UIApplication.shared.applicationState == .active else {
            fail("The desktop viewer stopped. Reconnect to continue.")
            return
        }
        processRecoveries += 1
        stop()
        let attempt = generation
        Task { [weak self] in
            guard let self, generation == attempt else { return }
            await start(resetRecovery: false)
        }
    }

    func dispose() {
        stop()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "desktop")
    }
}

private struct DesktopCanvas: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct ComputerView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model: ComputerModel
    @State private var text = ""
    @State private var sendingText = false
    @FocusState private var typing: Bool
    init(api: RoostAPI) { _model = StateObject(wrappedValue: ComputerModel(api: api)) }
    var body: some View {
        VStack(spacing: 0) {
            if model.enabled == false {
                ContentUnavailableView(
                    "No desktop configured", systemImage: "desktopcomputer",
                    description: Text(
                        "Enable the shared desktop on your Roost server to watch and control it here."
                    ))
            } else {
                HStack {
                    Label(
                        model.controlling
                            ? "You’re in control"
                            : model.connected ? "Live · watching" : "Connecting…",
                        systemImage: model.controlling ? "hand.point.up.left" : "eye"
                    )
                    .font(.subheadline)
                    Spacer()
                    if model.connected {
                        Button(model.controlling ? "Return control" : "Take control") {
                            Task { await model.setControl(!model.controlling) }
                        }
                        .buttonStyle(.bordered).disabled(model.working)
                        .accessibilityIdentifier("desktopControl")
                    }
                }
                .padding()
                if let error = model.error {
                    ErrorNotice(text: error)
                    Button("Reconnect") { Task { await model.start() } }.padding()
                }
                DesktopCanvas(webView: model.webView)
                    .id(ObjectIdentifier(model.webView))
                    .privacySensitive()
                    .overlay {
                        if !model.connected && model.error == nil {
                            ProgressView("Connecting to desktop…").tint(.white)
                                .foregroundStyle(.white)
                        }
                    }
                    .overlay { if scenePhase != .active { Color.black } }
                    .accessibilityLabel("Shared desktop")
                if model.controlling {
                    HStack {
                        TextField("Type on the desktop", text: $text).focused($typing)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .onSubmit { sendText() }
                        Button("Send", action: sendText).disabled(text.isEmpty || sendingText)
                    }
                    .padding()
                    HStack(spacing: 24) {
                        key("Escape", 0xff1b)
                        key("Tab", 0xff09)
                        key("Return", 0xff0d)
                        key("Delete", 0xff08)
                    }
                    .font(.caption).padding(.bottom)
                }
            }
        }
        .background(palette.background)
        .navigationTitle("Computer")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: scenePhase) {
            if scenePhase == .active { await model.start() } else { model.stop() }
        }
        .onDisappear { model.stop() }
    }
    private func key(_ title: String, _ value: Int) -> some View {
        Button(title) { Task { await model.sendKey(value) } }.frame(minHeight: 44)
    }
    private func sendText() {
        guard !sendingText, !text.isEmpty else { return }
        let value = text
        sendingText = true
        Task {
            defer { sendingText = false }
            if await model.sendText(value), text == value { text = "" }
        }
    }
}
