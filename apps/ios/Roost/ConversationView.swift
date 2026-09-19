import QuickLook
import SwiftUI
import UniformTypeIdentifiers

struct ConversationView: View {
    @Environment(\.palette) private var palette

    let app: AppModel
    @Bindable var model: ConversationModel
    var title: String? = nil
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.roostReduceMotion) private var reduceMotion
    @AppStorage("responseStyle") private var responseStyle: ResponseStyle = .messages
    @State private var showThreads = false
    @State private var replyID: String?
    @State private var showFiles = false
    @State private var preview: URL?
    @State private var followBottom = true
    @State private var composerFrame = CGRect.zero
    @State private var flight: MessageFlight?
    @State private var sendFeedback = 0
    @FocusState private var composing: Bool
    private var isMain: Bool { model.conversationId == model.agent.id }

    private var visibleEntries: [Entry] {
        model.displayedEntries.filter { responseStyle == .codex || $0.message.role != "activity" }
    }

    var body: some View {
        ScrollViewReader { proxy in
            scrollingContent(proxy: proxy)
        }
        .sheet(isPresented: $showThreads) {
            NavigationStack {
                List(model.threads) { thread in
                    Button {
                        showThreads = false
                        replyID = thread.id
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(thread.parent.text)
                                .lineLimit(3)
                                .foregroundStyle(palette.foreground)
                            Text(
                                thread.replyCount == 1
                                    ? "1 reply" : "\(thread.replyCount) replies"
                            )
                            .font(.caption)
                            .foregroundStyle(palette.muted)
                        }
                        .padding(.vertical, 6)
                    }
                    .listRowBackground(palette.surface)
                }
                .overlay {
                    if model.threads.isEmpty {
                        ContentUnavailableView(
                            "No reply threads yet", systemImage: "bubble.left.and.bubble.right",
                            description: Text(
                                "Swipe right on an assistant message to start a focused conversation."
                            ))
                    }
                }
                .themedScreen()
                .navigationTitle("Reply threads")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Done") { showThreads = false } }
            }
        }
        .navigationDestination(item: $replyID) { id in
            if let child = app.conversation(agent: model.agent, id: id) {
                ConversationView(app: app, model: child)
            }
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item]) { result in
            Task {
                do {
                    let url = try result.get()
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    model.uploading = true
                    defer { model.uploading = false }
                    let values = try url.resourceValues(forKeys: [
                        .fileSizeKey, .contentTypeKey,
                    ])
                    guard (values.fileSize ?? Int.max) <= 20 * 1024 * 1024 else {
                        throw APIError(message: "Choose a file smaller than 20 MB.")
                    }
                    let data = try Data(contentsOf: url)
                    let attachment = try await model.api.upload(
                        agentId: model.agent.id, name: url.lastPathComponent,
                        mimeType: values.contentType?.preferredMIMEType
                            ?? "application/octet-stream", bytes: data)
                    model.attachments.append(attachment)
                } catch { model.error = error.localizedDescription }
            }
        }
        .quickLookPreview($preview)
    }

    private func scrollingContent(proxy: ScrollViewProxy) -> some View {
        ScrollView {
            timeline
        }
        .themedScreen()
        .scrollDismissesKeyboard(.interactively)
        .defaultScrollAnchor(.bottom)
        .refreshable { await model.refresh() }
        .onChange(of: model.entries) { old, new in
            if followBottom || old.isEmpty { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .onChange(of: model.pending?.messageId) { _, id in
            if id != nil { proxy.scrollTo("bottom", anchor: .bottom) }
        }
        .onChange(of: model.draft) { _, _ in model.persistDraft() }
        .onChange(of: model.attachments) { _, _ in model.persistDraft() }
        .onChange(of: composing) { _, focused in
            if focused {
                withAnimation(reduceMotion ? nil : RoostMotion.settle) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .overlay {
            GeometryReader { geometry in
                if let flight, let destination = flight.destination {
                    FlyingMessage(
                        flight: flight, destination: destination,
                        container: geometry.frame(in: .global), agent: model.agent,
                        style: isMain ? responseStyle : .codex
                    ) {
                        if self.flight?.id == flight.id { self.flight = nil }
                    }
                    .id(flight.id)
                }
            }
            .allowsHitTesting(false)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: sendFeedback)
        .onDisappear { flight = nil }
        .task(id: flight?.id) {
            guard let id = flight?.id else { return }
            // A screen/keyboard change must never leave the real row hidden.
            do { try await Task.sleep(for: .seconds(1.5)) } catch { return }
            if flight?.id == id { flight = nil }
        }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced { flight = nil }
        }
        .navigationTitle(title ?? (isMain ? model.agent.name : "Reply thread"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { conversationToolbar }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do {
                    try await Task.sleep(
                        for: .seconds(model.error != nil ? 8 : model.busy ? 1 : 4))
                } catch { break }
            }
        }
    }

    private var timeline: some View {
        LazyVStack(
            alignment: .leading, spacing: isMain && responseStyle == .messages ? 12 : 24
        ) {
            if model.before != nil {
                Button("Load earlier messages") { Task { await model.loadOlder() } }
                    .frame(maxWidth: .infinity)
            }
            if let parent = model.threads.first(where: { $0.id == model.conversationId })?
                .parent
            {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Replying to", systemImage: "arrow.turn.down.right")
                        .font(.caption)
                        .foregroundStyle(palette.muted)
                    Text(parent.text)
                        .lineLimit(5)
                        .font(.subheadline)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: 12))
            }
            ForEach(visibleEntries) { entry in
                MessageView(
                    message: entry.message, agent: model.agent,
                    style: isMain ? responseStyle : .codex,
                    canReply: isMain,
                    reply: { Task { replyID = await model.reply(to: entry.message) } },
                    file: { file in Task { await open(file) } }
                )
                .modifier(
                    MessageEntrance(animated: model.arrivingMessageIDs.contains(entry.id))
                )
                .opacity(flight?.id == entry.id ? 0 : 1)
                .onGeometryChange(for: CGRect.self) { geometry in
                    geometry.frame(in: .global)
                } action: { frame in
                    if flight?.id == entry.id, frame.height > 0, flight?.destination != frame {
                        flight?.destination = frame
                    }
                }
                .id(entry.id)
            }
            ForEach(model.approvals) { approval in
                ApprovalView(model: model, approval: approval)
                    .transition(.opacity)
            }
            if model.loading && model.displayedEntries.isEmpty {
                ProgressView("Loading conversation…")
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
            }
            if !model.loading && model.displayedEntries.isEmpty {
                VStack(spacing: 16) {
                    CharacterView(name: model.agent.character, size: 80)
                    Text(
                        isMain
                            ? "Start with \(model.agent.name)" : "Continue in this thread"
                    )
                    .font(.title2.weight(.medium))
                    Text(
                        isMain
                            ? "Send a task, ask a question, or share a file."
                            : "Replies share your agent’s context."
                    )
                    .foregroundStyle(palette.muted).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 60)
            }
            if model.busy && model.approvals.isEmpty {
                TypingIndicator(name: model.agent.name, queued: model.status == "queued")
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .scale(scale: 0.75, anchor: .bottomLeading)
                                .combined(with: .opacity)
                    )
            }
            Color.clear.frame(height: 1).id("bottom")
                .onAppear { followBottom = true }
                .onDisappear { followBottom = false }
        }
        .padding(20)
        .animation(
            reduceMotion ? nil : RoostMotion.settle,
            value: model.busy && model.approvals.isEmpty)
    }

    @ToolbarContentBuilder
    private var conversationToolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            HStack(spacing: 8) {
                CharacterView(name: model.agent.character, size: 28)
                Text(isMain ? model.agent.name : "Reply thread")
                    .font(.headline)
            }
        }
        if isMain {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showThreads = true
                } label: {
                    Image(systemName: "bubble.left.and.bubble.right")
                }
                .accessibilityLabel("Reply threads")
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 10) {
            if let error = model.error { ErrorNotice(text: error).lineLimit(4) }
            if model.deliveryUnconfirmed && !model.sending {
                Text("Delivery is unconfirmed. Retry safely with the same message.")
                    .font(.caption)
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal)
            }
            if model.pending == nil && model.messageLength > 32000 {
                Text("This message is too long. Shorten it before sending.")
                    .font(.caption)
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal)
            }
            if !model.attachments.isEmpty && model.pending == nil {
                ScrollView(.horizontal) {
                    HStack {
                        ForEach(model.attachments) { file in
                            HStack {
                                Image(systemName: "doc")
                                Text(file.name)
                                    .lineLimit(1)
                                Button {
                                    model.attachments.removeAll { $0.id == file.id }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                }
                                .accessibilityLabel("Remove \(file.name)")
                                .disabled(model.pending != nil)
                            }
                            .font(.caption)
                            .padding(8)
                            .background(palette.surface, in: Capsule())
                        }
                    }
                    .padding(.horizontal)
                }
            }
            HStack(alignment: .bottom, spacing: 10) {
                Button {
                    showFiles = true
                } label: {
                    if model.uploading { ProgressView() } else { Image(systemName: "plus") }
                }
                .frame(width: 44, height: 44).accessibilityLabel("Attach a file")
                .disabled(model.uploading || model.attachments.count >= 5 || model.pending != nil)
                TextField(
                    model.busy ? "Add a follow-up…" : "Message \(model.agent.name)…",
                    text: Binding(
                        get: { model.pending == nil ? model.draft : "" },
                        set: { if model.pending == nil { model.draft = $0 } }
                    ), axis: .vertical
                )
                .lineLimit(1...6)
                .padding(.vertical, 12).focused($composing)
                .allowsHitTesting(model.pending == nil)
                .accessibilityIdentifier("messageComposer")
                if model.showsStop {
                    Button {
                        Task { await model.stop() }
                    } label: {
                        Image(systemName: "stop.fill")
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel("Stop response")
                } else {
                    Button {
                        followBottom = true
                        sendMessage()
                    } label: {
                        Image(
                            systemName: model.sending
                                ? "ellipsis"
                                : model.pending != nil
                                    ? "arrow.clockwise.circle.fill" : "arrow.up.circle.fill"
                        )
                        .font(.system(size: 32))
                        .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(model.pending != nil ? "Retry message" : "Send message")
                    .accessibilityIdentifier("sendMessage")
                    .disabled(!model.canSend)
                }
            }
            .padding(.horizontal, 8)
            .background(palette.bubble, in: RoundedRectangle(cornerRadius: 24))
            .onGeometryChange(for: CGRect.self) { geometry in
                geometry.frame(in: .global)
            } action: {
                composerFrame = $0
            }
            .buttonStyle(PressFeedback())
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
        .background(palette.background)
    }

    private func sendMessage() {
        let retry = model.pending != nil
        do {
            guard try model.prepareSend() != nil else { return }
            if !retry {
                sendFeedback += 1
                if !reduceMotion, composerFrame.height > 0, let message = model.outgoingMessage {
                    flight = MessageFlight(message: message, origin: composerFrame)
                }
            }
            Task { await model.send() }
        } catch { model.error = error.localizedDescription }
    }

    private func open(_ file: Attachment) async {
        do {
            let bytes = try await model.api.request(
                "files",
                query: [
                    URLQueryItem(name: "agentId", value: model.agent.id),
                    URLQueryItem(name: "id", value: file.id),
                ])
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent(
                    "RoostPreviews", isDirectory: true
                )
                .appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete])
            let name = URL(fileURLWithPath: file.name).lastPathComponent
                .replacingOccurrences(of: "\n", with: " ")
                .replacingOccurrences(of: "\r", with: " ")
            let url = directory.appendingPathComponent(
                name.isEmpty || name == "." || name == ".." ? "Attachment" : name)
            try bytes.write(to: url, options: [.atomic, .completeFileProtection])
            preview = url
        } catch { model.error = error.localizedDescription }
    }
}
