import SwiftUI

struct ApprovalView: View {
    @Environment(\.palette) private var palette

    let model: ConversationModel
    let approval: Approval
    @State private var answers: [String: String] = [:]
    @State private var working = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(approval.title, systemImage: "hand.raised")
                .font(.headline)
            MarkdownText(text: approval.details)
            ForEach(approval.questions ?? []) { question in
                VStack(alignment: .leading, spacing: 10) {
                    Text(question.question).fontWeight(.medium)
                    ForEach(Array(question.options.enumerated()), id: \.offset) { _, option in
                        Button {
                            answers[question.id] = option.label
                        } label: {
                            HStack(alignment: .top) {
                                Image(
                                    systemName: answers[question.id] == option.label
                                        ? "checkmark.circle.fill" : "circle")
                                VStack(alignment: .leading) {
                                    Text(option.label)
                                    if !option.description.isEmpty {
                                        Text(option.description)
                                            .font(.caption)
                                            .foregroundStyle(palette.muted)
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 6)
                        }
                    }
                    if question.allowOther {
                        TextField(
                            "Your answer",
                            text: Binding(
                                get: { answers[question.id] ?? "" },
                                set: { answers[question.id] = $0 }), axis: .vertical
                        )
                        .textFieldStyle(.roundedBorder)
                    }
                }
            }
            if let error { ErrorNotice(text: error) }
            HStack {
                if approval.questions?.isEmpty != false {
                    Button("Decline", role: .destructive) { respond("decline") }
                        .buttonStyle(.bordered)
                }
                Spacer()
                if let questions = approval.questions, !questions.isEmpty {
                    Button("Send answers") { respond("answer") }.buttonStyle(.borderedProminent)
                        .disabled(
                            questions.contains {
                                (answers[$0.id] ?? "")
                                    .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            })
                } else {
                    Button("Approve once") { respond("approve") }.buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("approveOnce")
                }
            }
            .disabled(working)
        }
        .padding(16)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private func respond(_ decision: String) {
        working = true
        Task {
            defer { working = false }
            do { try await model.answer(approval, decision: decision, answers: answers) } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
