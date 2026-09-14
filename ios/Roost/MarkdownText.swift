import SwiftUI

// Native selectable Markdown; fenced code keeps whitespace and scrolls horizontally.
struct MarkdownText: View {
    @Environment(\.palette) private var palette

    let text: String

    var body: some View {
        let pieces = text.components(separatedBy: "```")
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(pieces.enumerated()), id: \.offset) { index, piece in
                if index % 2 == 1 {
                    let code =
                        piece.contains("\n")
                        ? String(piece.drop(while: { $0 != "\n" }).dropFirst()) : piece
                    ScrollView(.horizontal) {
                        Text(code)
                            .font(.system(.callout, design: .monospaced))
                            .padding(12)
                    }
                    .background(palette.surface, in: RoundedRectangle(cornerRadius: 10))
                } else if !piece.isEmpty {
                    Text(
                        (try? AttributedString(
                            markdown: piece,
                            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
                            ?? AttributedString(piece)
                    )
                    .lineSpacing(4)
                }
            }
        }
    }
}
