import SwiftUI

struct DashboardActionRequest: Codable, Equatable {
    enum Action: String, Codable {
        case addTodo = "add-todo"
        case setTodo = "set-todo"
        case deleteTodo = "delete-todo"
        case addMeal = "add-meal"
        case deleteMeal = "delete-meal"
    }
    let key: String
    let expectedRevision: Int
    let blockId: String
    let action: Action
    let id: String
    var label: String?
    var done: Bool?
    var date: String?
    var calories: Int?
}

struct DashboardTrackerRequest: Codable, Equatable {
    let key: String
    let kind: DashboardTrackerKind
    let title: String
}

enum DashboardTrackerKind: String, Codable, CaseIterable, Identifiable {
    case todo, calories
    var id: String { rawValue }
    var title: String { self == .todo ? "To-do list" : "Calorie log" }
    var symbol: String { self == .todo ? "checklist" : "fork.knife" }
}

struct DashboardTrackerDraft {
    var todo = ""
    var meal = ""
    var calories = ""
    var day = Date.now
}

enum DashboardTrackerValues {
    static func day(_ date: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 1, parts.month ?? 1, parts.day ?? 1)
    }
    static func calories(_ text: String) -> Int? {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.allSatisfy({ $0.isASCII && $0.isNumber }),
            let value = Int(text), (0...20000).contains(value)
        else { return nil }
        return value
    }
    static func total(_ entries: [DashboardMeal], day: String) -> Int {
        entries.filter { $0.date == day }.reduce(0) { $0 + $1.calories }
    }
}

struct DashboardTrackerView: View {
    @Environment(\.palette) private var palette
    @Environment(JuxiDashboardModel.self) private var model
    let widgetKey: String
    let revision: Int?
    let block: DashboardBlock
    @FocusState private var editing: Bool
    private var token: String { widgetKey + "/" + (block.id ?? "") }
    private var pending: DashboardActionRequest? { model.trackerRequests[token] }
    private var locked: Bool { model.updating || pending != nil || revision == nil }
    private var draft: Binding<DashboardTrackerDraft> {
        Binding(
            get: { model.trackerDrafts[token] ?? DashboardTrackerDraft() },
            set: { model.trackerDrafts[token] = $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if block.type == "todo-list" { todos } else { meals }
            if let error = model.trackerErrors[token] {
                ErrorNotice(text: error)
                if let pending {
                    Button("Retry change") { Task { _ = await model.trackerAction(pending) } }
                        .disabled(model.updating)
                }
            }
            if revision == nil {
                Text("Update your Roost server to edit this tracker.")
                    .font(.caption).foregroundStyle(palette.muted)
            }
            if model.updating && pending != nil {
                ProgressView("Saving…").font(.caption)
            }
        }
        .onAppear {
            if model.trackerDrafts[token] == nil {
                model.trackerDrafts[token] = DashboardTrackerDraft()
            }
        }
    }

    private var todos: some View {
        VStack(alignment: .leading, spacing: 12) {
            if (block.items ?? []).isEmpty {
                Text("Add your first task.").font(.subheadline).foregroundStyle(palette.muted)
            }
            ForEach(Array((block.items ?? []).enumerated()), id: \.element.id) { _, item in
                if let id = item.id {
                    HStack(alignment: .top, spacing: 12) {
                        Button {
                            perform(.setTodo, id: id, done: !(item.done ?? false))
                        } label: {
                            Image(
                                systemName: item.done == true ? "checkmark.circle.fill" : "circle"
                            )
                            .foregroundStyle(item.done == true ? palette.accent : palette.muted)
                            .font(.title3).frame(minWidth: 44, minHeight: 44)
                        }
                        .disabled(locked)
                        .accessibilityLabel(
                            "Mark \(item.label) \(item.done == true ? "incomplete" : "complete")"
                        )
                        .accessibilityIdentifier("todo-toggle-\(id)")
                        Text(item.label).strikethrough(item.done == true)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        Button(role: .destructive) {
                            perform(.deleteTodo, id: id)
                        } label: {
                            Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
                        }
                        .disabled(locked).accessibilityLabel("Delete \(item.label)")
                    }
                }
            }
            HStack(alignment: .center) {
                TextField("Add a task", text: draft.todo)
                    .focused($editing).submitLabel(.done).onSubmit(addTodo)
                    .disabled(locked).accessibilityIdentifier("todo-input-\(block.id ?? "")")
                Button(action: addTodo) {
                    Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
                }
                .disabled(
                    locked || !validLabel(draft.wrappedValue.todo)
                        || (block.items?.count ?? 0) >= 100
                )
                .accessibilityLabel("Add task")
            }
            .padding(.leading, 12)
            .background(palette.background, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var meals: some View {
        let day = DashboardTrackerValues.day(draft.wrappedValue.day)
        let entries = (block.entries ?? []).filter { $0.date == day }
        return VStack(alignment: .leading, spacing: 16) {
            DatePicker("Day", selection: draft.day, displayedComponents: .date)
                .disabled(locked).accessibilityIdentifier("calorie-day-\(block.id ?? "")")
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(DashboardTrackerValues.total(block.entries ?? [], day: day).formatted())
                    .font(.system(.largeTitle, design: .rounded).weight(.semibold))
                Text("kcal logged").font(.subheadline).foregroundStyle(palette.muted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("calorie-total-\(block.id ?? "")")
            if entries.isEmpty { Text("No entries for this day.").foregroundStyle(palette.muted) }
            ForEach(entries) { entry in
                HStack {
                    Text(entry.label).frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(entry.calories) kcal").foregroundStyle(palette.muted)
                    Button(role: .destructive) {
                        perform(.deleteMeal, id: entry.id)
                    } label: {
                        Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
                    }
                    .disabled(locked).accessibilityLabel("Delete \(entry.label)")
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                TextField("Meal or snack", text: draft.meal)
                    .focused($editing).textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("meal-input-\(block.id ?? "")")
                HStack {
                    TextField("Calories", text: draft.calories)
                        .keyboardType(.numberPad).focused($editing).textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("calories-input-\(block.id ?? "")")
                    Button("Add meal", action: addMeal).buttonStyle(.borderedProminent)
                        .disabled(
                            !validLabel(draft.wrappedValue.meal)
                                || DashboardTrackerValues.calories(draft.wrappedValue.calories)
                                    == nil
                                || (block.entries?.count ?? 0) >= 200)
                }
                Text("Enter calories from your own source.")
                    .font(.caption).foregroundStyle(palette.muted)
            }
            .disabled(locked)
        }
    }

    private func validLabel(_ value: String) -> Bool {
        let count = value.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        return (1...200).contains(count)
    }
    private func addTodo() {
        guard !locked, validLabel(draft.wrappedValue.todo) else { return }
        editing = false
        perform(
            .addTodo, label: draft.wrappedValue.todo.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }
    private func addMeal() {
        guard !locked, validLabel(draft.wrappedValue.meal),
            let calories = DashboardTrackerValues.calories(draft.wrappedValue.calories)
        else { return }
        editing = false
        perform(
            .addMeal,
            label: draft.wrappedValue.meal.trimmingCharacters(in: .whitespacesAndNewlines),
            date: DashboardTrackerValues.day(draft.wrappedValue.day), calories: calories)
    }
    private func perform(
        _ action: DashboardActionRequest.Action, id: String = UUID().uuidString,
        label: String? = nil, done: Bool? = nil, date: String? = nil, calories: Int? = nil
    ) {
        guard !locked, let revision, let blockId = block.id else { return }
        let request = DashboardActionRequest(
            key: widgetKey, expectedRevision: revision, blockId: blockId,
            action: action, id: id, label: label, done: done, date: date, calories: calories)
        Task { _ = await model.trackerAction(request) }
    }
}

struct DashboardTrackerCreation: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(JuxiDashboardModel.self) private var model
    let kind: DashboardTrackerKind
    @State private var title: String
    private var request: DashboardTrackerRequest? { model.pendingTrackerCreation }
    init(kind: DashboardTrackerKind) {
        self.kind = kind
        _title = State(initialValue: kind.title)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Tracker name", text: $title)
                        .disabled(model.updating || request != nil)
                        .accessibilityIdentifier("tracker-title")
                }
                if let error = model.error { ErrorNotice(text: error) }
                Button(request == nil ? "Create tracker" : "Retry creating tracker") {
                    let request =
                        request
                        ?? DashboardTrackerRequest(
                            key: kind.rawValue + "-" + UUID().uuidString.lowercased(),
                            kind: kind, title: title.trimmingCharacters(in: .whitespacesAndNewlines)
                        )
                    Task {
                        if await model.createTracker(request) {
                            dismiss()
                        }
                    }
                }
                .disabled(
                    model.updating || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || title.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 100)
                if model.updating { ProgressView("Creating…") }
            }
            .navigationTitle("New \(kind.title.lowercased())")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(model.updating)
                }
            }
            .interactiveDismissDisabled(model.updating)
            .onAppear { if let request { title = request.title } }
        }
    }
}
