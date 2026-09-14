import SwiftUI

struct CodingJobsView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    let app: AppModel
    let agent: Agent
    let api: RoostAPI
    let start: () -> Void
    @State private var jobs: [CodingJob]?
    @State private var error: String?
    @State private var filter = "All"
    private let filters = ["All", "Working", "Review", "Finished"]
    private var filtered: [CodingJob] {
        (jobs ?? [])
            .filter { job in
                switch filter {
                case "Working": ["queued", "starting", "running", "blocked"].contains(job.status)
                case "Review": job.status == "review"
                case "Finished": !job.canStop
                default: true
                }
            }
    }
    var body: some View {
        List {
            if let error { ErrorNotice(text: error).listRowBackground(palette.background) }
            if !(jobs ?? []).isEmpty {
                Picker("Show jobs", selection: $filter) {
                    ForEach(filters, id: \.self) { Text($0) }
                }
                .pickerStyle(.segmented).listRowBackground(palette.background)
            }
            ForEach(filtered) { job in
                NavigationLink {
                    CodingJobView(app: app, model: CodingModel(api: api, agent: agent, id: job.id))
                } label: {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top) {
                            Text(job.title).font(.headline)
                            Spacer(minLength: 8)
                            Circle().fill(job.status == "review" ? palette.review : palette.accent)
                                .frame(width: 7, height: 7).padding(.top, 6)
                        }
                        Text(job.summary.isEmpty ? job.brief : job.summary)
                            .font(.subheadline).foregroundStyle(palette.muted).lineLimit(2)
                        HStack {
                            Text(job.label(job.workspace))
                                .foregroundStyle(
                                    job.status == "review" ? palette.review : palette.accent)
                            Spacer()
                            Text(Date(milliseconds: job.updatedAt), style: .relative)
                                .foregroundStyle(palette.muted)
                        }
                        .font(.caption)
                    }
                    .padding(.vertical, 10)
                }
                .listRowBackground(palette.background)
                .listRowSeparatorTint(palette.border)
                .accessibilityIdentifier("job-" + job.title)
            }
        }
        .listStyle(.plain).themedScreen()
        .overlay {
            if jobs == nil && error == nil {
                ProgressView("Loading jobs…")
            } else if jobs?.isEmpty == true {
                ContentUnavailableView {
                    Label("Make something with \(agent.name)", systemImage: "hammer")
                } description: {
                    Text(
                        "Start an assignment in chat. Its progress, preview, and conversations will live here."
                    )
                } actions: {
                    Button("Start an assignment", action: start).buttonStyle(.borderedProminent)
                }
            } else if filtered.isEmpty && error == nil {
                ContentUnavailableView(
                    "No jobs in this view", systemImage: "line.3.horizontal.decrease.circle")
            }
        }
        .navigationTitle("\(agent.name)’s coding")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button(action: start) { Image(systemName: "plus") }
                .accessibilityLabel("Start an assignment")
        }
        .refreshable { await refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(8)) } catch { break }
            }
        }
    }
    private func refresh() async {
        do {
            jobs = try await api.get("agents/\(agent.id)/jobs")
            error = nil
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

struct CodingJobView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    let app: AppModel
    @State var model: CodingModel
    @State private var acknowledgeID: String?
    @State private var showStop = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let error = model.error {
                    ErrorNotice(text: error)
                    Button("Refresh") {
                        Task {
                            model.error = nil
                            await model.refresh()
                        }
                    }
                }
                if let detail = model.detail {
                    header(detail)
                    workspace(detail)
                    NavigationLink {
                        WorkerConversationView(model: model)
                    } label: {
                        workspaceLink(
                            "Talk to worker",
                            subtitle: "Speak directly to this assignment’s worker", icon: "terminal"
                        )
                    }
                    .accessibilityIdentifier("open-worker")
                    NavigationLink {
                        if let conversation = app.conversation(
                            agent: model.agent, id: detail.workspace.conversationId)
                        {
                            ConversationView(app: app, model: conversation, title: "Job discussion")
                        }
                    } label: {
                        workspaceLink(
                            "Talk to \(model.agent.name)",
                            subtitle: "Discuss the assignment with your agent",
                            icon: "bubble.left.and.bubble.right")
                    }
                    DisclosureGroup("Saved feedback") { feedback(detail).padding(.top, 16) }
                    DisclosureGroup("Assignment") {
                        MarkdownText(text: detail.job.brief).padding(.top, 12)
                    }
                    if !detail.job.output.isEmpty {
                        DisclosureGroup("Worker output") {
                            Text(detail.job.output).font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled).padding(.top, 12)
                        }
                    }
                    if detail.job.canStop {
                        Button(
                            detail.job.cancelRequested ? "Stopping…" : "Stop job",
                            role: .destructive
                        ) { showStop = true }
                        .disabled(model.busy || detail.job.cancelRequested)
                    }
                } else if model.error == nil {
                    ProgressView("Loading workspace…").frame(maxWidth: .infinity)
                }
            }
            .padding(20)
        }
        .themedScreen()
        .navigationTitle("Job workspace")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(4)) } catch { break }
            }
        }
        .onChange(of: model.draft.feedback) { _, _ in model.persist() }
        .confirmationDialog(
            "Stop this job? The worker will be interrupted; its work is preserved.",
            isPresented: $showStop, titleVisibility: .visible
        ) {
            Button("Stop job", role: .destructive) { Task { await model.action("stop") } }
        }
    }
    private func header(_ detail: CodingDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(detail.job.label(detail.workspace)).font(.subheadline.weight(.medium))
                .foregroundStyle(palette.accent)
            Text(detail.job.title).font(.title2.weight(.semibold))
            if !detail.job.summary.isEmpty {
                Text(detail.job.summary).foregroundStyle(palette.muted)
            }
            if !detail.job.error.isEmpty { ErrorNotice(text: detail.job.error) }
        }
    }
    private func workspace(_ detail: CodingDetail) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if let url = workspaceURL(detail.workspace.previewUrl) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let running = detail.workspace.previewState(now: context.date) == "running"
                    VStack(alignment: .leading, spacing: 8) {
                        Link(destination: url) {
                            Label(
                                running ? "Open preview" : "Try last preview", systemImage: "safari"
                            )
                            .frame(maxWidth: .infinity).padding(12)
                        }
                        .buttonStyle(.borderedProminent)
                        Text(
                            running
                                ? "Reported running · expires \(Date(milliseconds: detail.workspace.previewExpiresAt).formatted(date: .omitted, time: .shortened))"
                                : "Preview is not currently confirmed running"
                        )
                        .font(.caption).foregroundStyle(palette.muted)
                        if !detail.workspace.previewRevision.isEmpty {
                            Text("Last reported revision: \(detail.workspace.previewRevision)")
                                .font(.caption).foregroundStyle(palette.muted)
                        }
                    }
                }
            }
            if !detail.workspace.latestChanges.isEmpty {
                Text("Latest changes").font(.headline)
                MarkdownText(text: detail.workspace.latestChanges)
            }
            if !detail.workspace.verification.isEmpty {
                Text("Verification").font(.headline)
                MarkdownText(text: detail.workspace.verification)
                Text(
                    detail.workspace.integration == "verified"
                        ? "Integration reported verified" : "Integration pending"
                )
                .font(.caption).foregroundStyle(palette.muted)
            }
            ForEach(Array(detail.workspace.pullRequests.enumerated()), id: \.offset) {
                index, value in
                if let url = workspaceURL(value) {
                    Link(destination: url) {
                        Label(
                            "Review pull request\(detail.workspace.pullRequests.count > 1 ? " \(index + 1)" : "")",
                            systemImage: "arrow.up.right")
                    }
                }
            }
        }
    }
    private func workspaceLink(_ title: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.title3).frame(width: 24).foregroundStyle(palette.accent)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).foregroundStyle(palette.foreground)
                Text(subtitle).font(.caption).foregroundStyle(palette.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(palette.muted)
        }
        .padding(16).background(palette.surface, in: RoundedRectangle(cornerRadius: 18))
    }
    private func feedback(_ detail: CodingDetail) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(
                "Saving feedback keeps it here. Continue sends your selection to the existing worker."
            )
            .font(.subheadline).foregroundStyle(palette.muted)
            ForEach(detail.feedback) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.text).textSelection(.enabled)
                    Text(item.delivery ?? "Saved; not submitted").font(.caption)
                        .foregroundStyle(palette.muted)
                    if !item.error.isEmpty { ErrorNotice(text: item.error) }
                    if item.inputId == nil {
                        Toggle(
                            "Include in continuation",
                            isOn: Binding(
                                get: { model.selected.contains(item.id) },
                                set: { value in
                                    if value {
                                        model.selected.insert(item.id)
                                    } else {
                                        model.selected.remove(item.id)
                                    }
                                })
                        )
                        .font(.caption).disabled(model.busy || model.draft.continuation != nil)
                    }
                }
                .padding(14).background(palette.surface, in: RoundedRectangle(cornerRadius: 16))
            }
            TextField(
                "What would you like to change?", text: $model.draft.feedback, axis: .vertical
            )
            .lineLimit(3...10).padding(14)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: 16))
            .disabled(model.busy || model.draft.feedbackRequest != nil)
            .accessibilityIdentifier("jobFeedback")
            Button(model.draft.feedbackRequest == nil ? "Save feedback" : "Retry saving feedback") {
                Task { await model.saveFeedback() }
            }
            .disabled(
                model.busy
                    || model.draft.feedback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || model.draft.feedback.count > 16_000)
            Button(
                model.draft.continuation == nil
                    ? "Continue with selected feedback" : "Retry continuation"
            ) { Task { await model.resume() } }
            .disabled(
                model.busy
                    || (model.draft.continuation == nil
                        && (model.selected.isEmpty || model.selected.count > 50
                            || !detail.job.canContinue))
            )
            if model.draft.continuation != nil {
                Button("Review a new selection") {
                    model.draft.continuation = nil
                    model.persist()
                }
                Text("Review the latest delivery status before submitting again.").font(.caption)
                    .foregroundStyle(palette.muted)
            }
        }
    }
}

struct WorkerConversationView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var model: CodingModel
    @State private var acknowledgeID: String?
    @FocusState private var composing: Bool
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if let error = model.error { ErrorNotice(text: error) }
                    if let detail = model.detail {
                        if detail.messages.isEmpty {
                            ContentUnavailableView(
                                "Talk directly to your worker", systemImage: "terminal",
                                description: Text(
                                    "Messages stay with this assignment and are delivered when the worker is ready."
                                ))
                        }
                        ForEach(detail.messages) { message in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(message.text).padding(14)
                                    .background(
                                        palette.bubble, in: RoundedRectangle(cornerRadius: 20)
                                    )
                                    .frame(maxWidth: .infinity, alignment: .trailing)
                                if !message.response.isEmpty {
                                    MarkdownText(text: message.response).padding(14)
                                        .background(
                                            palette.surface, in: RoundedRectangle(cornerRadius: 20))
                                } else if ["queued", "delivered", "responding"]
                                    .contains(message.status)
                                {
                                    TypingIndicator(
                                        name: "Worker", queued: message.status == "queued")
                                }
                                Text(statusLabel(message.status)).font(.caption)
                                    .foregroundStyle(palette.muted)
                                if !message.previewCheck.isEmpty {
                                    Text(message.previewCheck).font(.caption)
                                        .textSelection(.enabled)
                                }
                                if !message.error.isEmpty { ErrorNotice(text: message.error) }
                                if message.status == "failed" {
                                    Button("I inspected this in Herdr") {
                                        acknowledgeID = message.id
                                    }
                                    .disabled(!detail.job.canContinue || model.busy)
                                }
                            }
                            .id(message.id)
                        }
                        ForEach(detail.queueBlockers, id: \.self) { id in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(
                                    "An uncertain submission is holding this queue. Inspect it in Herdr before continuing."
                                )
                                Button("I inspected this in Herdr") { acknowledgeID = id }
                                    .disabled(!detail.job.canContinue || model.busy)
                            }
                        }
                        if !detail.job.canMessage {
                            Text(
                                "The worker is unavailable. Resolve approvals or check its state in Herdr."
                            )
                            .font(.subheadline).foregroundStyle(palette.muted)
                        }
                    }
                    Color.clear.frame(height: 1).id("worker-bottom")
                }
                .padding(16)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                HStack(alignment: .bottom, spacing: 12) {
                    TextField("Message the worker…", text: $model.draft.message, axis: .vertical)
                        .lineLimit(1...6).focused($composing)
                        .disabled(model.draft.workerRequest != nil && !model.busy)
                        .accessibilityIdentifier("workerComposer")
                    Button {
                        Task { await model.sendWorker() }
                    } label: {
                        Image(
                            systemName: model.draft.workerRequest == nil
                                ? "arrow.up.circle.fill" : "arrow.clockwise.circle.fill"
                        )
                        .font(.title)
                    }
                    .accessibilityLabel(
                        model.draft.workerRequest == nil ? "Send to worker" : "Retry worker message"
                    )
                    .disabled(
                        model.busy
                            || model.draft.message.trimmingCharacters(in: .whitespacesAndNewlines)
                                .isEmpty
                            || model.draft.message.count > 16_000
                            || (model.draft.workerRequest == nil
                                && (model.detail?.job.canMessage != true
                                    || model.detail?.queueBlockers.isEmpty == false
                                    || model.detail?.messages
                                        .contains(where: { $0.status == "failed" }) == true))
                    )
                }
                .padding(16).background(palette.surface)
            }
            .onChange(of: model.detail?.messages.count) { _, _ in
                proxy.scrollTo("worker-bottom", anchor: .bottom)
            }
        }
        .themedScreen().navigationTitle("Talk to worker").navigationBarTitleDisplayMode(.inline)
        .onChange(of: model.draft.message) { _, _ in model.persist() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(3)) } catch { break }
            }
        }
        .confirmationDialog(
            "Confirm you inspected this submission in the existing worker. It will not be replayed; remaining queued messages may proceed.",
            isPresented: Binding(
                get: { acknowledgeID != nil }, set: { if !$0 { acknowledgeID = nil } }),
            titleVisibility: .visible
        ) {
            Button("Confirm inspection") {
                if let id = acknowledgeID {
                    Task { await model.action("acknowledge", input: ["inputId": id]) }
                }
                acknowledgeID = nil
            }
        }
    }
    private func statusLabel(_ status: String) -> String {
        switch status {
        case "queued": "Waiting for the worker to be ready"
        case "delivered": "Delivered to the worker"
        case "responding": "Worker is responding"
        case "answered": "Response captured from worker output"
        case "response_unavailable": "Turn finished; response could not be captured"
        case "acknowledged": "Inspected; will not be replayed"
        default: status.capitalized
        }
    }
}
