import SwiftUI

struct AutomationsView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: AutomationsModel
    @State private var editing: AutomationDraft?
    @State private var deleting: AgentAutomation?

    init(api: RoostAPI, agent: Agent) {
        _model = State(initialValue: AutomationsModel(api: api, agent: agent))
    }

    var body: some View {
        List {
            if let error = model.error {
                Section { ErrorNotice(text: error) }
                    .listRowBackground(palette.surface)
            }
            if let snapshot = model.snapshot {
                Section {
                    if snapshot.automations.isEmpty {
                        ContentUnavailableView {
                            Label(
                                "Make time for what matters", systemImage: "clock.arrow.circlepath")
                        } description: {
                            Text("Give \(model.agent.name) a task to do on a schedule.")
                        } actions: {
                            Button("New automation") { editing = AutomationDraft() }
                                .buttonStyle(.borderedProminent)
                        }
                        .listRowBackground(Color.clear)
                    }
                    ForEach(snapshot.automations) { automation in
                        NavigationLink {
                            AutomationDetailsView(model: model, id: automation.id)
                        } label: {
                            automationRow(automation)
                        }
                        .contextMenu {
                            Button("Edit", systemImage: "pencil") {
                                editing = AutomationDraft(automation: automation)
                            }
                            Button(
                                automation.enabled ? "Pause" : "Resume",
                                systemImage: automation.enabled ? "pause" : "play"
                            ) {
                                Task { await model.toggle(automation) }
                            }
                            Button("Run now", systemImage: "play.circle") {
                                Task { await model.runNow(automation) }
                            }
                            Button("Delete", systemImage: "trash", role: .destructive) {
                                deleting = automation
                            }
                        }
                        .disabled(model.busy)
                        .accessibilityIdentifier("automation-\(automation.id)")
                    }
                } header: {
                    Text("Scheduled tasks")
                } footer: {
                    Text("Roost and its server need to stay running. Your iPhone can be asleep.")
                }
                .listRowBackground(palette.surface)

                Section {
                    if snapshot.runs.isEmpty {
                        Text("Completed and active tasks appear here.")
                            .foregroundStyle(palette.muted)
                    }
                    ForEach(snapshot.runs) { run in
                        NavigationLink {
                            AutomationRunView(model: model, id: run.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(run.title).font(.body.weight(.medium))
                                Text(
                                    "\(run.status.capitalized) · \(Date(milliseconds: run.createdAt).formatted(date: .abbreviated, time: .shortened))"
                                )
                                .font(.caption).foregroundStyle(palette.muted)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                } header: {
                    Text("Recent runs")
                } footer: {
                    Text("Includes chats, delegated tasks, and scheduled runs.")
                }
                .listRowBackground(palette.surface)
            } else if model.error == nil {
                ProgressView("Loading automations…").listRowBackground(palette.surface)
            }
        }
        .themedScreen().textCase(nil)
        .navigationTitle("Automations")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editing = AutomationDraft()
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("New automation")
                .accessibilityIdentifier("newAutomation")
            }
        }
        .refreshable { await model.refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await model.refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) } catch { break }
                await model.refresh()
            }
        }
        .sheet(item: $editing) { draft in
            AutomationEditor(model: model, initial: draft)
        }
        .confirmationDialog(
            "Delete automation?",
            isPresented: Binding(
                get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible
        ) {
            if let deleting {
                Button("Delete \(deleting.name)", role: .destructive) {
                    Task { await model.delete(deleting) }
                }
            }
        } message: {
            Text(
                "This removes the schedule, cancels queued runs, and stops work in progress. Past run history stays available."
            )
        }
    }

    private func automationRow(_ automation: AgentAutomation) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(automation.name).font(.body.weight(.semibold))
                Spacer(minLength: 8)
                Text(automation.enabled ? "On" : "Paused")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(automation.enabled ? palette.accent : palette.muted)
            }
            Text(automation.schedule.summary).font(.subheadline).foregroundStyle(palette.muted)
            if let next = automation.nextRunAt {
                Text(
                    "Next \(Date(milliseconds: next).formatted(date: .abbreviated, time: .shortened))"
                )
                .font(.caption).foregroundStyle(palette.muted)
            }
        }
        .padding(.vertical, 5)
    }
}

private struct AutomationDetailsView: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let model: AutomationsModel
    let id: String
    @State private var editing: AutomationDraft?
    @State private var confirmDelete = false
    private var automation: AgentAutomation? { model.snapshot?.automations.first { $0.id == id } }

    var body: some View {
        Form {
            if let error = model.error {
                ErrorNotice(text: error).listRowBackground(palette.surface)
            }
            if let automation {
                Section("Task") { Text(automation.prompt).textSelection(.enabled) }
                    .listRowBackground(palette.surface)
                Section("Schedule") {
                    LabeledContent("Repeats", value: automation.schedule.summary)
                    if let zone = automation.schedule.timezone {
                        LabeledContent(
                            "Time zone", value: zone.replacingOccurrences(of: "_", with: " "))
                    }
                    if let start = automation.schedule.startsOn {
                        LabeledContent("Starts", value: start)
                    }
                    if let end = automation.schedule.endsOn { LabeledContent("Ends", value: end) }
                    if let next = automation.nextRunAt {
                        LabeledContent(
                            "Next run",
                            value: Date(milliseconds: next)
                                .formatted(date: .abbreviated, time: .shortened))
                    }
                    LabeledContent("Status", value: automation.enabled ? "On" : "Paused")
                    LabeledContent(
                        "Notifications",
                        value: automation.notification == "always" ? "Every run" : "When needed")
                    LabeledContent("Model", value: automation.model ?? "Agent default")
                }
                .listRowBackground(palette.surface)
                Section {
                    Button("Run now", systemImage: "play.circle") {
                        Task { await model.runNow(automation) }
                    }
                    Button(
                        automation.enabled ? "Pause automation" : "Resume automation",
                        systemImage: automation.enabled ? "pause.circle" : "play.circle"
                    ) {
                        Task { await model.toggle(automation) }
                    }
                } footer: {
                    Text(
                        "Pausing cancels queued work. To stop a run already in progress, open it in Recent runs."
                    )
                }
                .listRowBackground(palette.surface).disabled(model.busy)
                Section {
                    Button("Delete automation", role: .destructive) { confirmDelete = true }
                }
                .listRowBackground(palette.surface).disabled(model.busy)
            } else {
                ContentUnavailableView(
                    "Automation removed", systemImage: "clock.badge.xmark",
                    description: Text("Its past runs remain in Recent runs."))
            }
        }
        .themedScreen().textCase(nil)
        .navigationTitle(automation?.name ?? "Automation")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let automation {
                Button("Edit") { editing = AutomationDraft(automation: automation) }
                    .disabled(model.busy)
            }
        }
        .sheet(item: $editing) { draft in AutomationEditor(model: model, initial: draft) }
        .confirmationDialog(
            "Delete this automation?", isPresented: $confirmDelete, titleVisibility: .visible
        ) {
            if let automation {
                Button("Delete automation", role: .destructive) {
                    Task {
                        await model.delete(automation)
                        if model.error == nil { dismiss() }
                    }
                }
            }
        } message: {
            Text(
                "This cancels queued runs and stops any run in progress. Past run history stays available."
            )
        }
    }
}

private struct AutomationEditor: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    let model: AutomationsModel
    let initial: AutomationDraft
    @State private var draft: AutomationDraft
    @State private var models: [AutomationModelOption] = []
    @State private var modelsLoaded = false
    @State private var modelError: String?
    @State private var error: String?
    @State private var preview: AutomationPreview?
    @State private var previewError: String?
    @State private var saving = false
    @State private var confirmDiscard = false
    @State private var conflict = false
    @State private var confirmReload = false
    @State private var ready = false
    private var draftURL: URL {
        WorkspaceDrafts.url(
            api: model.api, agent: model.agent.id,
            key: "automation-\(initial.expectedRevision == nil ? "new" : initial.id)")
    }

    init(model: AutomationsModel, initial: AutomationDraft) {
        self.model = model
        self.initial = initial
        _draft = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    Section {
                        ErrorNotice(text: error)
                        if conflict {
                            Button("Reload saved version") { confirmReload = true }
                        }
                    }
                    .listRowBackground(palette.surface)
                }
                taskSection
                scheduleSection
                if draft.kind != "once" { dateWindowSection }
                Section("Next runs") {
                    if let preview {
                        ForEach(preview.runs, id: \.self) { run in
                            Text(
                                Date(milliseconds: run)
                                    .formatted(date: .abbreviated, time: .shortened))
                        }
                    } else if let previewError {
                        Text(previewError).font(.subheadline).foregroundStyle(palette.muted)
                        Button("Check schedule again") { Task { await loadPreview() } }
                    } else {
                        ProgressView("Checking schedule…")
                    }
                }
                .listRowBackground(palette.surface)
                optionsSection
            }
            .disabled(saving)
            .themedScreen().textCase(nil)
            .navigationTitle(initial.expectedRevision == nil ? "New automation" : "Edit automation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if draft != initial { confirmDiscard = true } else { dismiss() }
                    }
                    .disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(saving || !draft.valid || preview == nil)
                        .accessibilityIdentifier("saveAutomation")
                }
            }
            .interactiveDismissDisabled(saving || draft != initial)
            .confirmationDialog(
                "Discard changes?", isPresented: $confirmDiscard, titleVisibility: .visible
            ) {
                Button("Discard changes", role: .destructive) {
                    try? FileManager.default.removeItem(at: draftURL)
                    dismiss()
                }
                Button("Keep draft and close") {
                    persist()
                    dismiss()
                }
            }
            .confirmationDialog(
                "Replace your edits with the saved version?", isPresented: $confirmReload,
                titleVisibility: .visible
            ) {
                Button("Reload saved version", role: .destructive) {
                    Task {
                        await model.refresh()
                        if let saved = model.snapshot?.automations
                            .first(where: { $0.id == draft.id })
                        {
                            draft = AutomationDraft(automation: saved)
                            error = nil
                            conflict = false
                        } else {
                            error =
                                "This automation was removed. Close this draft and create a new automation."
                        }
                    }
                }
            }
            .task {
                do {
                    if let saved = try WorkspaceDrafts.load(AutomationDraft.self, from: draftURL) {
                        draft = saved
                    }
                } catch {
                    self.error = "Could not restore your draft. " + error.localizedDescription
                }
                ready = true
                struct Options: Decodable { let models: [AutomationModelOption] }
                do {
                    let options: Options = try await model.api.get(model.path + "/models")
                    models = options.models
                    modelsLoaded = true
                } catch {
                    modelError =
                        "Models could not be loaded. You can use the agent default or keep the saved selection."
                }
            }
            .task(id: draft.schedule) {
                preview = nil
                previewError = nil
                do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
                await loadPreview()
            }
            .onChange(of: draft) { _, _ in if ready { persist() } }
        }
    }

    private var taskSection: some View {
        Section {
            TextField("Name", text: $draft.name).accessibilityIdentifier("automationName")
            TextField("What should this agent do?", text: $draft.prompt, axis: .vertical)
                .lineLimit(4...10).accessibilityLabel("Task")
                .accessibilityIdentifier("automationPrompt")
        } header: {
            Text("Task")
        } footer: {
            Text(
                "Each run starts fresh with this task and the agent’s memory. Include the context it will need."
            )
        }
        .listRowBackground(palette.surface)
    }

    private var scheduleSection: some View {
        Section("Schedule") {
            Picker("Repeat", selection: $draft.kind) {
                Text("Weekly").tag("weekly")
                Text("At an interval").tag("interval")
                Text("One time").tag("once")
                Text("Custom (cron)").tag("cron")
            }
            if draft.kind == "weekly" {
                DatePicker(
                    "Time",
                    selection: Binding(
                        get: { timeDate(draft.time) },
                        set: { draft.time = timeString($0) }), displayedComponents: .hourAndMinute)
                NavigationLink {
                    List(0...6, id: \.self) { day in
                        Button {
                            if draft.days.contains(day) {
                                draft.days.removeAll { $0 == day }
                            } else {
                                draft.days.append(day)
                            }
                        } label: {
                            HStack {
                                Text(Calendar.current.weekdaySymbols[day])
                                    .foregroundStyle(palette.foreground)
                                Spacer()
                                if draft.days.contains(day) {
                                    Image(systemName: "checkmark").foregroundStyle(palette.accent)
                                }
                            }
                        }
                        .accessibilityAddTraits(draft.days.contains(day) ? .isSelected : [])
                        .listRowBackground(palette.surface)
                    }
                    .themedScreen().navigationTitle("Days")
                } label: {
                    LabeledContent(
                        "Days",
                        value: draft.days.count == 7 ? "Every day" : "\(draft.days.count) selected")
                }
            } else if draft.kind == "interval" {
                TextField("Every (minutes)", text: $draft.minutes).keyboardType(.numberPad)
                    .accessibilityLabel("Interval in minutes")
            } else if draft.kind == "once" {
                DatePicker(
                    "Run at", selection: $draft.at, displayedComponents: [.date, .hourAndMinute]
                )
                .environment(\.timeZone, TimeZone(identifier: draft.timezone) ?? .current)
            } else {
                TextField("Cron expression", text: $draft.expression).font(.body.monospaced())
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Text(
                    "Five fields: minute, hour, day of month, month, day of week. Example: 0 9 * * * runs daily at 9 AM."
                )
                .font(.caption).foregroundStyle(palette.muted)
            }
            NavigationLink {
                AutomationTimezonePicker(selection: $draft.timezone)
            } label: {
                LabeledContent(
                    "Time zone", value: draft.timezone.replacingOccurrences(of: "_", with: " "))
            }
        }
        .listRowBackground(palette.surface)
    }

    private var dateWindowSection: some View {
        Section("Date range (optional)") {
            dateBound("Start date", value: $draft.startsOn)
            dateBound("End date", value: $draft.endsOn)
        }
        .listRowBackground(palette.surface)
    }

    private func dateBound(_ title: String, value: Binding<String>) -> some View {
        VStack(alignment: .leading) {
            Toggle(
                title,
                isOn: Binding(
                    get: { !value.wrappedValue.isEmpty },
                    set: {
                        value.wrappedValue = $0 ? dayString(Date()) : ""
                    }))
            if !value.wrappedValue.isEmpty {
                DatePicker(
                    title,
                    selection: Binding(
                        get: { dayDate(value.wrappedValue) },
                        set: {
                            value.wrappedValue = dayString($0)
                        }), displayedComponents: .date
                )
                .labelsHidden()
            }
        }
    }

    private var optionsSection: some View {
        Section("Run options") {
            Picker("Notify me", selection: $draft.notification) {
                Text("When needed").tag("when-needed")
                Text("Every run").tag("always")
            }
            Picker("Model", selection: $draft.model) {
                Text("Agent default").tag("")
                if !draft.model.isEmpty && !models.contains(where: { $0.model == draft.model }) {
                    Text(draft.model + " (saved)").tag(draft.model)
                }
                ForEach(models) { option in Text(option.displayName).tag(option.model) }
            }
            if let modelError { Text(modelError).font(.caption).foregroundStyle(palette.muted) }
            if modelsLoaded && !draft.model.isEmpty
                && !models.contains(where: { $0.model == draft.model })
            {
                Text(
                    "This model is unavailable. Choose another model or the agent default before running this automation."
                )
                .font(.caption).foregroundStyle(palette.muted)
            }
        }
        .listRowBackground(palette.surface)
    }

    private func persist() {
        do { try WorkspaceDrafts.save(draft, to: draftURL) } catch {
            self.error = "Could not save your draft. " + error.localizedDescription
        }
    }

    private func loadPreview() async {
        let schedule = draft.schedule
        struct PreviewRequest: Encodable { let schedule: AutomationSchedule }
        do {
            let data = try await model.api.post(
                model.path + "/preview", PreviewRequest(schedule: schedule))
            guard !Task.isCancelled, schedule == draft.schedule else { return }
            preview = try JSONDecoder().decode(AutomationPreview.self, from: data)
            previewError = nil
        } catch {
            guard !Task.isCancelled, schedule == draft.schedule else { return }
            previewError = error.localizedDescription
        }
    }

    private func save() async {
        guard draft.valid, !saving else { return }
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await model.save(draft)
            try? FileManager.default.removeItem(at: draftURL)
            dismiss()
        } catch {
            self.error = error.localizedDescription
            conflict = (error as? APIError)?.status == 409
        }
    }

    private func formatter(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = pattern
        return formatter
    }
    private func timeDate(_ value: String) -> Date {
        formatter("HH:mm").date(from: value) ?? Date()
    }
    private func timeString(_ value: Date) -> String { formatter("HH:mm").string(from: value) }
    private func dayDate(_ value: String) -> Date {
        formatter("yyyy-MM-dd").date(from: value) ?? Date()
    }
    private func dayString(_ value: Date) -> String { formatter("yyyy-MM-dd").string(from: value) }
}

private struct AutomationTimezonePicker: View {
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Binding var selection: String
    @State private var search = ""
    private var zones: [String] {
        TimeZone.knownTimeZoneIdentifiers.filter {
            search.isEmpty
                || $0.replacingOccurrences(of: "_", with: " ")
                    .localizedCaseInsensitiveContains(search)
        }
    }
    var body: some View {
        List(zones, id: \.self) { zone in
            Button {
                selection = zone
                dismiss()
            } label: {
                HStack {
                    Text(zone.replacingOccurrences(of: "_", with: " "))
                        .foregroundStyle(palette.foreground)
                    Spacer()
                    if zone == selection {
                        Image(systemName: "checkmark").foregroundStyle(palette.accent)
                    }
                }
            }
            .accessibilityAddTraits(zone == selection ? .isSelected : [])
            .listRowBackground(palette.surface)
        }
        .themedScreen().navigationTitle("Time zone").searchable(text: $search)
    }
}

private struct AutomationRunView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    let model: AutomationsModel
    let id: String
    @State private var run: AutomationRun?
    @State private var error: String?
    @State private var refreshGeneration = 0

    var body: some View {
        List {
            if let error { ErrorNotice(text: error).listRowBackground(palette.surface) }
            if let run {
                Section {
                    LabeledContent("Status", value: run.status.capitalized)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Status")
                        .accessibilityValue(run.status.capitalized)
                        .accessibilityIdentifier("automationRunStatus")
                    LabeledContent(
                        "Created",
                        value: Date(milliseconds: run.createdAt)
                            .formatted(date: .abbreviated, time: .shortened))
                    if let started = run.startedAt {
                        LabeledContent(
                            "Started",
                            value: Date(milliseconds: started)
                                .formatted(date: .abbreviated, time: .shortened))
                    }
                    if let finished = run.finishedAt {
                        LabeledContent(
                            "Finished",
                            value: Date(milliseconds: finished)
                                .formatted(date: .abbreviated, time: .shortened))
                    }
                    if run.active {
                        Button("Stop run", systemImage: "stop.circle") {
                            Task {
                                await model.stop(id)
                                error = model.error
                                await refresh()
                            }
                        }
                        .disabled(model.busy)
                    }
                    if let failure = run.error { ErrorNotice(text: failure) }
                }
                .listRowBackground(palette.surface)
                Section("Task") { Text(run.prompt).textSelection(.enabled) }
                    .listRowBackground(palette.surface)
                Section("Output") {
                    if run.output.isEmpty {
                        Text("No output recorded yet.").foregroundStyle(palette.muted)
                    }
                    ForEach(run.output) { message in
                        if message.role == "activity" {
                            DisclosureGroup(message.title ?? "Activity") {
                                if let details = message.details {
                                    Text(details).font(.caption.monospaced())
                                        .textSelection(.enabled)
                                }
                                Text(message.text).font(.caption.monospaced())
                                    .textSelection(.enabled)
                            }
                        } else {
                            MarkdownText(text: message.text)
                        }
                    }
                }
                .listRowBackground(palette.surface)
            } else if error == nil {
                ProgressView("Loading run…").listRowBackground(palette.surface)
            }
        }
        .themedScreen().textCase(nil).navigationTitle("Run details")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await refresh() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await refresh()
            while !Task.isCancelled && (run?.active ?? true) {
                do { try await Task.sleep(for: .seconds(3)) } catch { break }
                await refresh()
            }
        }
    }

    private func refresh() async {
        refreshGeneration += 1
        let generation = refreshGeneration
        do {
            let value: AutomationRun = try await model.api.get(
                "agents/\(model.agent.id)/runs/\(id)")
            guard !Task.isCancelled, generation == refreshGeneration else { return }
            run = value
            error = nil
        } catch {
            if !Task.isCancelled, generation == refreshGeneration {
                self.error = error.localizedDescription
            }
        }
    }
}
