import SwiftUI

struct MessageView: View {
    @Environment(\.palette) private var palette

    let message: Message
    let agent: Agent
    let style: ResponseStyle
    let canReply: Bool
    let reply: () -> Void
    let file: (Attachment) -> Void

    private var isUser: Bool { message.role == "user" }
    private var isConversationMessage: Bool {
        message.role == "user" || message.role == "assistant"
    }

    var body: some View {
        Group {
            if isConversationMessage && style == .messages {
                bubble
            } else {
                transcriptRow
            }
        }
        .modifier(SwipeToReply(enabled: canReply && message.role == "assistant", reply: reply))
        .contextMenu {
            Button("Copy text") { UIPasteboard.general.string = message.text }
            if canReply && message.role == "assistant" {
                Button("Reply in thread", action: reply)
            }
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !isUser, let title = message.title {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(palette.muted)
            }
            messageBody
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .foregroundStyle(isUser ? palette.onAction : palette.foreground)
        .tint(isUser ? palette.onAction : palette.accent)
        .background(
            isUser ? palette.action : palette.bubble,
            in: UnevenRoundedRectangle(
                topLeadingRadius: 18,
                bottomLeadingRadius: isUser ? 18 : 5,
                bottomTrailingRadius: isUser ? 5 : 18,
                topTrailingRadius: 18
            )
        )
        .containerRelativeFrame(.horizontal, alignment: isUser ? .trailing : .leading) { width, _ in
            // Match the web Messages style's 88% maximum bubble width.
            (width - 40) * 0.88
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }

    private var transcriptRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            if message.role == "activity" {
                activity
            } else if message.role == "notice" {
                notice
            } else {
                author
                messageBody
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(isUser ? 14 : 0)
        .background(isUser ? palette.surface : .clear, in: RoundedRectangle(cornerRadius: 16))
    }

    private var author: some View {
        HStack(spacing: 8) {
            if !isUser { CharacterView(name: agent.character, size: 24) }
            Text(isUser ? "You" : agent.name)
                .font(.subheadline.weight(.semibold))
            if let date = message.createdAt {
                Text(Date(timeIntervalSince1970: date / 1000), style: .time)
                    .font(.caption)
                    .foregroundStyle(palette.faint)
            }
        }
    }

    private var messageBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isUser {
                Text(message.text)
                    .textSelection(.enabled)
            } else {
                MarkdownText(text: message.text)
                    .textSelection(.enabled)
            }
            if let files = message.files {
                ForEach(files) { attachment in
                    Button {
                        file(attachment)
                    } label: {
                        Label(attachment.name, systemImage: "doc")
                    }
                    .font(.subheadline)
                }
            }
        }
    }

    private var activity: some View {
        DisclosureGroup {
            Text(message.text + (message.details.map { "\n" + $0 } ?? ""))
                .font(.system(.caption, design: .monospaced))
                .textSelection(.enabled)
        } label: {
            Label(message.title ?? "Activity", systemImage: "terminal")
                .font(.subheadline)
                .foregroundStyle(palette.muted)
        }
        .accessibilityIdentifier("toolActivity")
    }

    private var notice: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                if let title = message.title { Text(title).fontWeight(.medium) }
                Text(message.text)
            }
        } icon: {
            Image(systemName: "circle.dotted")
        }
        .font(.footnote)
        .foregroundStyle(palette.muted)
    }
}
// A directional gesture leaves vertical scrolling, text selection, and the
// navigation edge gesture available. Reply affordance exists only during drag.
private struct SwipeToReply: ViewModifier {
    @Environment(\.palette) private var palette
    @Environment(\.roostReduceMotion) private var reduceMotion

    let enabled: Bool
    let reply: () -> Void
    @GestureState private var drag = ReplyDrag()

    private struct ReplyDrag {
        var horizontal: Bool?
        var offset: CGFloat = 0
    }
    private var armed: Bool { drag.offset >= 72 }

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content
                .offset(x: drag.offset)
                .background(alignment: .leading) {
                    if drag.offset > 0 {
                        Image(systemName: "arrowshape.turn.up.left.fill")
                            .foregroundStyle(palette.accent)
                            .opacity(min(drag.offset / 72, 1))
                            .scaleEffect(reduceMotion || armed ? 1 : 0.8)
                            .accessibilityHidden(true)
                    }
                }
                .contentShape(Rectangle())
                .simultaneousGesture(
                    DragGesture(minimumDistance: 24)
                        .updating($drag) { value, state, _ in
                            if state.horizontal == nil {
                                state.horizontal =
                                    value.startLocation.x > 8
                                    && value.translation.width > abs(value.translation.height) * 1.5
                            }
                            if state.horizontal == true {
                                state.offset = min(96, max(0, value.translation.width))
                            }
                        }
                        .onEnded { value in
                            if value.startLocation.x > 8 && value.translation.width >= 72
                                && value.translation.width > abs(value.translation.height) * 1.5
                            {
                                reply()
                            }
                        }
                )
                .sensoryFeedback(.selection, trigger: armed)
                .animation(reduceMotion ? nil : RoostMotion.settle, value: drag.offset == 0)
                .accessibilityAction(named: Text("Reply in thread"), reply)
        } else {
            content
        }
    }
}
