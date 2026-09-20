import SwiftUI

struct FeedView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    let app: AppModel
    @State private var model: FeedModel
    @State private var showPreferences = false

    init(app: AppModel, api: RoostAPI) {
        self.app = app
        _model = State(initialValue: FeedModel(api: api))
    }

    var body: some View {
        NavigationStack {
            List {
                Picker("Show feed", selection: $model.filter) {
                    ForEach(FeedFilter.allCases) { filter in
                        Text(filter.title).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)
                .accessibilityIdentifier("feedFilter")

                if let error = model.error ?? model.status?.lastError {
                    VStack(alignment: .leading, spacing: 8) {
                        ErrorNotice(text: error)
                        Button("Try again") { Task { await model.load() } }
                    }
                    .listRowSeparator(.hidden)
                }
                if let notice = model.notice {
                    HStack {
                        Text(notice).font(.footnote).foregroundStyle(palette.muted)
                        Spacer()
                        if let dismissed = model.lastDismissed {
                            Button("Restore") { Task { await model.act(dismissed, "restore") } }
                                .font(.footnote.weight(.medium))
                        }
                        Button("Dismiss", systemImage: "xmark") { model.notice = nil }
                            .labelStyle(.iconOnly)
                    }
                    .listRowSeparator(.hidden)
                }
                if model.settings?.enabled == false && !model.items.isEmpty {
                    Text("Feed paused").font(.caption).foregroundStyle(palette.muted)
                        .listRowSeparator(.hidden)
                } else if model.status?.refreshing == true {
                    ProgressView("Finding stories and updates…")
                        .font(.footnote).listRowSeparator(.hidden)
                } else if let time = model.status?.lastRefreshedAt {
                    Text("Updated \(Date(milliseconds: time), style: .relative) ago")
                        .font(.caption).foregroundStyle(palette.muted)
                        .listRowSeparator(.hidden)
                }

                if model.visibleItems.isEmpty {
                    emptyState.listRowSeparator(.hidden)
                }
                ForEach(model.visibleItems) { item in
                    NavigationLink(value: item) {
                        FeedRow(item: item)
                    }
                    .accessibilityIdentifier("feed-item-" + item.id)
                    .listRowSeparatorTint(palette.border)
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button("Dismiss", systemImage: "xmark", role: .destructive) {
                            Task { await model.act(item, "dismiss") }
                        }
                        Button(item.saved ? "Unsave" : "Save", systemImage: "bookmark") {
                            Task { await model.act(item, item.saved ? "unsave" : "save") }
                        }
                        .tint(palette.accent)
                    }
                    .contextMenu {
                        FeedItemActions(model: model, item: item)
                    }
                    .disabled(model.changing.contains(item.id))
                }
                if model.nextCursor != nil {
                    Button {
                        Task { await model.load(more: true) }
                    } label: {
                        HStack {
                            Spacer()
                            if model.loadingMore { ProgressView() } else { Text("Load more") }
                            Spacer()
                        }
                    }
                    .disabled(model.loadingMore || model.loading)
                    .listRowSeparator(.hidden)
                }
            }
            .listRowBackground(palette.background)
            .listStyle(.plain)
            .themedScreen()
            .navigationTitle("Feed")
            .navigationDestination(for: FeedItem.self) { item in
                FeedReaderView(app: app, model: model, item: item)
            }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh feed")
                    .disabled(model.settings?.enabled != true || model.status?.refreshing == true)
                    Button {
                        showPreferences = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                    }
                    .accessibilityLabel("Feed preferences")
                    .disabled(model.settings == nil)
                }
            }
            .sheet(isPresented: $showPreferences) {
                if let settings = model.settings {
                    FeedPreferencesView(model: model, app: app, settings: settings)
                }
            }
            .refreshable {
                if model.settings?.enabled == true {
                    await model.refresh()
                } else {
                    await model.load()
                }
            }
            .task(id: model.filter) { await model.load() }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                if model.settings != nil { await model.load() }
                while !Task.isCancelled {
                    do {
                        try await Task.sleep(for: .seconds(30))
                    } catch { break }
                    // Leave an expanded list in place while the reader browses older pages.
                    if model.items.count <= 30 { await model.load() }
                }
            }
            .task(id: scenePhase == .active && model.status?.refreshing == true) {
                guard scenePhase == .active, model.status?.refreshing == true else { return }
                while !Task.isCancelled && model.status?.refreshing == true {
                    do { try await Task.sleep(for: .seconds(2)) } catch { break }
                    await model.load()
                }
            }
        }
    }

    @ViewBuilder private var emptyState: some View {
        if model.loading && model.settings == nil {
            ProgressView("Loading your feed…")
                .frame(maxWidth: .infinity).padding(.vertical, 80)
        } else if model.settings?.enabled == false {
            ContentUnavailableView {
                Label("Your interests. One feed.", systemImage: "newspaper")
            } description: {
                Text(
                    "Follow publications and topics, and choose which personal updates belong here."
                )
            } actions: {
                Button("Set up your feed") { showPreferences = true }
                    .buttonStyle(.borderedProminent)
                    .foregroundStyle(palette.onAction)
                    .accessibilityIdentifier("feedSetup")
            }
        } else if model.error == nil {
            ContentUnavailableView {
                Label(emptyTitle, systemImage: model.filter == .saved ? "bookmark" : "newspaper")
            } description: {
                Text(emptyDescription)
            }
        }
    }

    private var emptyTitle: String {
        switch model.filter {
        case .all: "Your next read is on its way"
        case .unread: "You’re caught up"
        case .saved: "Your saved stories"
        }
    }

    private var emptyDescription: String {
        switch model.filter {
        case .all: "Refresh to check your sources, or adjust your feed preferences."
        case .unread: "New stories and important updates will appear here."
        case .saved: "Save something from your feed to return to it later."
        }
    }
}

private struct FeedRow: View {
    @Environment(\.palette) private var palette
    let item: FeedItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                if item.readAt == nil {
                    Circle().fill(palette.accent).frame(width: 5, height: 5)
                        .accessibilityLabel("Unread")
                }
                Text(item.attribution).lineLimit(1)
                Spacer(minLength: 4)
                if item.saved { Image(systemName: "bookmark.fill").accessibilityLabel("Saved") }
                if item.importance == "important" {
                    Image(systemName: "exclamationmark.circle.fill").accessibilityLabel("Important")
                }
            }
            .font(.caption.weight(.medium)).foregroundStyle(palette.muted)

            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title)
                        .font(.title3.weight(.semibold)).foregroundStyle(palette.foreground)
                        .lineLimit(3)
                    Text(item.summary)
                        .font(.subheadline).foregroundStyle(palette.muted).lineLimit(3)
                }
                if let raw = item.imageUrl, let url = workspaceURL(raw) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                                .frame(width: 84, height: 84)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .accessibilityHidden(true)
                        }
                    }
                }
            }
            Text(Date(milliseconds: item.publishedAt), style: .relative)
                .font(.caption).foregroundStyle(palette.faint)
        }
        .padding(.vertical, 15)
    }
}

struct FeedItemActions: View {
    let model: FeedModel
    let item: FeedItem
    var onChange: (FeedItem) -> Void = { _ in }

    var body: some View {
        Button(item.saved ? "Remove from saved" : "Save for later", systemImage: "bookmark") {
            act(item.saved ? "unsave" : "save")
        }
        Button(item.readAt == nil ? "Mark read" : "Mark unread", systemImage: "circle") {
            act(item.readAt == nil ? "read" : "unread")
        }
        Divider()
        Button("More like this", systemImage: "hand.thumbsup") {
            act("more")
        }
        Button("Less like this", systemImage: "hand.thumbsdown") {
            act("less")
        }
        Button("Dismiss", systemImage: "xmark", role: .destructive) {
            act("dismiss")
        }
    }

    private func act(_ action: String) {
        Task { if let updated = await model.act(item, action) { onChange(updated) } }
    }
}

private struct FeedReaderView: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let app: AppModel
    let model: FeedModel
    @State var item: FeedItem
    @State private var discussion: FeedDiscussion?
    @State private var discussing = false
    @State private var error: String?

    private var current: FeedItem { model.items.first { $0.id == item.id } ?? item }
    private var additionalCitations: [FeedItem.Citation] {
        current.citations.filter { $0.url != current.url }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(current.attribution)
                        .font(.subheadline.weight(.medium)).foregroundStyle(palette.muted)
                    Text(current.title)
                        .font(.largeTitle.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(Date(milliseconds: current.publishedAt), style: .date)
                        .font(.caption).foregroundStyle(palette.faint)
                }
                if let raw = current.imageUrl, let url = workspaceURL(raw) {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFit()
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                .accessibilityHidden(true)
                        }
                    }
                }
                MarkdownText(text: current.body.isEmpty ? current.summary : current.body)
                    .textSelection(.enabled)
                if !current.why.isEmpty {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("Why this is here").font(.subheadline.weight(.semibold))
                        Text(current.why).font(.subheadline).foregroundStyle(palette.muted)
                    }
                }
                if let raw = current.url, let url = workspaceURL(raw) {
                    Link(destination: url) {
                        Label("Read at \(current.sourceName)", systemImage: "arrow.up.right")
                    }
                    .font(.subheadline.weight(.medium))
                }
                if !additionalCitations.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Sources").font(.headline)
                        ForEach(Array(additionalCitations.enumerated()), id: \.offset) {
                            _, citation in
                            if let url = workspaceURL(citation.url) {
                                Link(destination: url) {
                                    Label(citation.title, systemImage: "arrow.up.right")
                                        .font(.subheadline)
                                }
                            }
                        }
                    }
                }
                Divider()
                if let error = error ?? model.error { ErrorNotice(text: error) }
                Button {
                    discussing = true
                    Task {
                        defer { discussing = false }
                        do {
                            let target = try await model.discuss(current)
                            if !app.agents.contains(where: { $0.id == target.agentId }) {
                                await app.refresh()
                            }
                            guard app.agents.contains(where: { $0.id == target.agentId }) else {
                                throw APIError(
                                    message:
                                        "This agent is no longer available. Choose another in feed preferences."
                                )
                            }
                            error = nil
                            discussion = target
                        } catch { self.error = error.localizedDescription }
                    }
                } label: {
                    HStack {
                        if discussing { ProgressView() }
                        Label("Discuss with an agent", systemImage: "bubble.left.and.bubble.right")
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 7)
                }
                .buttonStyle(.borderedProminent).disabled(discussing)
                .foregroundStyle(palette.onAction)
                .accessibilityIdentifier("feedDiscuss")
            }
            .padding(24).frame(maxWidth: 720, alignment: .leading).frame(maxWidth: .infinity)
        }
        .themedScreen()
        .environment(
            \.openURL,
            OpenURLAction { url in
                workspaceURL(url.absoluteString) == nil ? .discarded : .systemAction
            }
        )
        .navigationTitle("Story").navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task {
                        if let updated = await model.act(current, current.saved ? "unsave" : "save")
                        {
                            item = updated
                        }
                    }
                } label: {
                    Image(systemName: current.saved ? "bookmark.fill" : "bookmark")
                }
                .accessibilityLabel(current.saved ? "Remove from saved" : "Save for later")
                .disabled(model.changing.contains(item.id))
                Menu {
                    FeedItemActions(model: model, item: current) { item = $0 }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .accessibilityLabel("Story options")
            }
        }
        .task {
            if current.readAt == nil, let updated = await model.act(current, "read") {
                item = updated
            }
        }
        .onChange(of: current.dismissed) { _, dismissed in if dismissed { dismiss() } }
        .navigationDestination(item: $discussion) { target in
            if let agent = app.agents.first(where: { $0.id == target.agentId }),
                let conversation = app.conversation(agent: agent, id: target.conversationId)
            {
                ConversationView(app: app, model: conversation)
            }
        }
    }
}
