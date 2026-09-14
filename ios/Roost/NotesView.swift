import SwiftUI

struct NotesView: View {
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: NoteModel
    @State private var showHistory = false
    @State private var showInstructions = false
    @State private var showConflict = false
    @State private var editorError: String?

    init(agent: Agent, api: RoostAPI) {
        _model = State(initialValue: NoteModel(agent: agent, api: api))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = editorError ?? model.error {
                HStack(alignment: .top) {
                    ErrorNotice(text: error)
                    Button(editorError == nil ? "Retry" : "Dismiss") {
                        if editorError != nil {
                            editorError = nil
                        } else {
                            Task {
                                await model.save()
                                await model.refresh()
                            }
                        }
                    }
                }
                .padding(.horizontal).padding(.top, 8)
            }
            if model.remote != nil {
                Button("Review shared changes", systemImage: "arrow.triangle.branch") {
                    showConflict = true
                }
                .font(.subheadline).padding(10)
            }
            if model.draft != nil {
                NoteCanvas(
                    blocks: Binding(get: { model.draft?.blocks ?? [] }, set: { model.edit($0) }),
                    editable: model.canEdit,
                    onError: { editorError = $0 })
            } else {
                Spacer()
                if model.error == nil { ProgressView("Loading shared note…") }
                Spacer()
            }
        }
        .themedScreen()
        .navigationTitle("\(model.agent.name)’s notes")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Text(model.status)
                    Button("History", systemImage: "clock.arrow.circlepath") { showHistory = true }
                    Button("Instructions for agent", systemImage: "text.bubble") {
                        showInstructions = true
                    }
                    Button("Refresh shared note", systemImage: "arrow.clockwise") {
                        Task { await model.refresh() }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 17, weight: .medium))
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel("Note options")
            }
        }
        .sheet(isPresented: $showHistory) { NoteHistoryView(model: model) }
        .sheet(isPresented: $showInstructions) { NoteInstructionsView(model: model) }
        .sheet(isPresented: $showConflict) { NoteConflictView(model: model) }
        .task(id: model.change) {
            guard model.dirty, model.remote == nil, model.draft?.pending == nil else { return }
            do { try await Task.sleep(for: .milliseconds(800)) } catch { return }
            // A dispatched write finishes independently of the next keystroke.
            Task { await model.save() }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: .seconds(8)) } catch { break }
            }
        }
    }
}

struct NoteBlockText: View {
    @Environment(\.palette) private var palette
    let block: NoteBlock
    private var content: AttributedString {
        var result = AttributedString()
        for span in block.content {
            var value = AttributedString(span.text)
            var font: Font =
                block.type == "heading"
                ? (block.level == 1 ? .title : block.level == 3 ? .headline : .title3) : .body
            if span.bold == true || block.type == "heading" { font = font.bold() }
            if span.italic == true { font = font.italic() }
            value.font = font
            if let href = span.href, let url = URL(string: href),
                ["https", "http", "mailto"].contains(url.scheme ?? "")
            {
                value.link = url
            }
            result.append(value)
        }
        return result
    }
    var body: some View {
        if block.content.isEmpty || block.text.isEmpty {
            Text("Write something…").foregroundStyle(palette.muted)
        } else {
            Text(content)
                .foregroundStyle(block.checked == true ? palette.muted : palette.foreground)
                .strikethrough(block.checked == true)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct NoteConflictView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @Bindable var model: NoteModel
    var body: some View {
        NavigationStack {
            List {
                Section("On this iPhone") {
                    ForEach(model.draft?.blocks ?? []) { NoteBlockText(block: $0) }
                }
                Section("Latest shared version") {
                    ForEach(model.remote?.blocks ?? []) { NoteBlockText(block: $0) }
                }
                Section {
                    if model.draft?.pending != nil {
                        Text(
                            "A previous save is unconfirmed. Retry that save first to check its receipt."
                        )
                        Button("Retry previous save") {
                            Task {
                                await model.save()
                                await model.refresh()
                            }
                        }
                    } else {
                        Button("Keep my version") {
                            model.resolve(keepLocal: true)
                            dismiss()
                        }
                        Button("Use shared version") {
                            model.resolve(keepLocal: false)
                            dismiss()
                        }
                        Text(
                            "Both saved versions remain in revision history. Unsynced edits on this iPhone are replaced if you choose the shared version."
                        )
                        .font(.caption).foregroundStyle(palette.muted)
                    }
                }
            }
            .themedScreen().navigationTitle("Review changes").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }
}

struct NoteHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var model: NoteModel
    @State private var selected: NoteSnapshot?
    @State private var confirmRestore = false
    var body: some View {
        NavigationStack {
            List {
                if let error = model.error { ErrorNotice(text: error) }
                ForEach(model.history) { revision in
                    Button {
                        Task {
                            do { selected = try await model.revision(revision.revision) } catch {
                                model.error = error.localizedDescription
                            }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Revision \(revision.revision)")
                            Text(
                                "\(revision.source.hasPrefix("agent:") ? model.agent.name : "You") · \(Date(milliseconds: revision.updatedAt).formatted(date: .abbreviated, time: .shortened))"
                            )
                            .font(.caption)
                        }
                    }
                }
                if model.history.count >= 100 {
                    Button("Load older revisions") { Task { await model.loadHistory(older: true) } }
                }
            }
            .overlay {
                if model.history.isEmpty && model.error == nil {
                    ContentUnavailableView(
                        "No revisions yet", systemImage: "clock.arrow.circlepath")
                }
            }
            .themedScreen().navigationTitle("Note history").navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
            .task { await model.loadHistory() }
            .sheet(
                isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })
            ) {
                if let selected {
                    NavigationStack {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                ForEach(selected.blocks) { NoteBlockText(block: $0) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(20)
                        }
                        .themedScreen().navigationTitle("Revision \(selected.revision)")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Close") { self.selected = nil }
                            }
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Restore") { confirmRestore = true }
                                    .disabled(
                                        model.busy || model.dirty || model.remote != nil
                                            || model.draft?.pending != nil
                                            || selected.revision == model.draft?.base.revision)
                            }
                        }
                        .confirmationDialog(
                            "Restore this revision’s content? Current content remains in history. Agent instructions stay unchanged.",
                            isPresented: $confirmRestore, titleVisibility: .visible
                        ) {
                            Button("Restore revision") {
                                Task {
                                    await model.save(action: "/restore", restore: selected.revision)
                                    if model.error == nil {
                                        self.selected = nil
                                        await model.loadHistory()
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

struct NoteInstructionsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @Bindable var model: NoteModel
    @State private var text = ""
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text(
                    "Tell \(model.agent.name) how to maintain this shared note. These instructions stay separate from the note itself."
                )
                .font(.subheadline).foregroundStyle(palette.muted)
                if let error = model.error { ErrorNotice(text: error) }
                TextEditor(text: $text).scrollContentBackground(.hidden)
                    .padding(8).background(palette.surface, in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityIdentifier("noteInstructions")
                    .disabled(model.busy || model.draft?.pending != nil)
                Text("\(text.count) / 8,000").font(.caption).foregroundStyle(palette.muted)
            }
            .padding(20).themedScreen()
            .navigationTitle("Note instructions").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.draft?.pending == nil ? "Save" : "Retry") {
                        Task {
                            await model.save(action: "/instructions", instructions: text)
                            if model.error == nil { dismiss() }
                        }
                    }
                    .disabled(
                        model.busy || model.remote != nil || model.dirty || text.count > 8_000)
                }
            }
            .onAppear {
                text =
                    model.draft?.pending?.input.instructions ?? model.draft?.base.instructions ?? ""
            }
        }
    }
}
