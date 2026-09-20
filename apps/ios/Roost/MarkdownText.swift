import SwiftUI

enum MarkdownBlock: Equatable {
    case paragraph(String)
    case heading(Int, String)
    case listItem(String, String)
    case quote(String)
    case code(language: String, text: String)
    case table(MarkdownTable)
    case divider
}

struct MarkdownTable: Equatable {
    enum Alignment: Equatable { case leading, center, trailing }
    let headers: [String]
    let alignments: [Alignment]
    let rows: [[String]]
}

enum MarkdownBlocks {
    static func parse(_ text: String) -> [MarkdownBlock] {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var result: [MarkdownBlock] = []
        var paragraph: [String] = []
        var index = 0
        func flush() {
            if !paragraph.isEmpty {
                result.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph.removeAll()
            }
        }
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flush()
                index += 1
                continue
            }
            if let first = trimmed.first, first == "`" || first == "~" {
                let fence = String(trimmed.prefix(while: { $0 == first }))
                if fence.count >= 3 {
                    flush()
                    let language = String(trimmed.dropFirst(fence.count))
                        .trimmingCharacters(in: .whitespaces)
                    var code: [String] = []
                    index += 1
                    while index < lines.count {
                        let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                        if candidate.hasPrefix(fence), candidate.allSatisfy({ $0 == first }) {
                            index += 1
                            break
                        }
                        code.append(lines[index])
                        index += 1
                    }
                    result.append(.code(language: language, text: code.joined(separator: "\n")))
                    continue
                }
            }
            if index + 1 < lines.count, line.contains("|"),
                let alignments = tableAlignments(lines[index + 1])
            {
                let headers = tableCells(line)
                if headers.count == alignments.count {
                    flush()
                    index += 2
                    var rows: [[String]] = []
                    while index < lines.count, lines[index].contains("|"),
                        !lines[index].trimmingCharacters(in: .whitespaces).isEmpty
                    {
                        var cells = Array(tableCells(lines[index]).prefix(headers.count))
                        cells += Array(repeating: "", count: max(0, headers.count - cells.count))
                        rows.append(cells)
                        index += 1
                    }
                    result.append(
                        .table(MarkdownTable(headers: headers, alignments: alignments, rows: rows)))
                    continue
                }
            }
            let hashes = trimmed.prefix(while: { $0 == "#" }).count
            if (1...6).contains(hashes), trimmed.dropFirst(hashes).first == " " {
                flush()
                result.append(.heading(hashes, String(trimmed.dropFirst(hashes + 1))))
            } else if isDivider(trimmed) {
                flush()
                result.append(.divider)
            } else if trimmed.hasPrefix(">") {
                flush()
                result.append(
                    .quote(String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)))
            } else if let item = listItem(trimmed) {
                flush()
                result.append(.listItem(item.0, item.1))
            } else {
                paragraph.append(line)
            }
            index += 1
        }
        flush()
        return result
    }

    static func tableCells(_ line: String) -> [String] {
        var text = line.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("|") { text.removeFirst() }
        if text.hasSuffix("|"), !text.hasSuffix("\\|") { text.removeLast() }
        var cells: [String] = []
        var cell = ""
        var escaped = false
        var codeFence = 0
        var cursor = text.startIndex
        while cursor < text.endIndex {
            let char = text[cursor]
            if escaped {
                if char != "|" { cell.append("\\") }
                cell.append(char)
                escaped = false
            } else if char == "\\" {
                escaped = true
            } else if char == "`" {
                let run = text[cursor...].prefix(while: { $0 == "`" }).count
                cell += String(repeating: "`", count: run)
                if codeFence == 0 { codeFence = run } else if codeFence == run { codeFence = 0 }
                cursor = text.index(cursor, offsetBy: run)
                continue
            } else if char == "|" && codeFence == 0 {
                cells.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
            } else {
                cell.append(char)
            }
            cursor = text.index(after: cursor)
        }
        if escaped { cell.append("\\") }
        cells.append(cell.trimmingCharacters(in: .whitespaces))
        return cells
    }

    private static func tableAlignments(_ line: String) -> [MarkdownTable.Alignment]? {
        let cells = tableCells(line)
        guard !cells.isEmpty else { return nil }
        var alignments: [MarkdownTable.Alignment] = []
        for cell in cells {
            let dashes = cell.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
            guard dashes.count >= 3, dashes.allSatisfy({ $0 == "-" }) else { return nil }
            alignments.append(
                cell.hasSuffix(":") ? (cell.hasPrefix(":") ? .center : .trailing) : .leading)
        }
        return alignments
    }

    private static func isDivider(_ text: String) -> Bool {
        let characters = text.filter { !$0.isWhitespace }
        guard characters.count >= 3, let first = characters.first, "-*_".contains(first) else {
            return false
        }
        return characters.allSatisfy { $0 == first }
    }

    private static func listItem(_ text: String) -> (String, String)? {
        if let first = text.first, "-*+".contains(first), text.dropFirst().first == " " {
            let content = String(text.dropFirst(2))
            if content.hasPrefix("[ ] ") { return ("○", String(content.dropFirst(4))) }
            if content.lowercased().hasPrefix("[x] ") { return ("✓", String(content.dropFirst(4))) }
            return ("•", content)
        }
        let digits = text.prefix(while: { $0.isNumber })
        let suffix = text.dropFirst(digits.count)
        if !digits.isEmpty, let punctuation = suffix.first, ".)".contains(punctuation),
            suffix.dropFirst().first == " "
        {
            return (String(digits) + ".", String(suffix.dropFirst(2)))
        }
        return nil
    }
}

struct MarkdownText: View {
    @Environment(\.palette) private var palette
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownBlocks.parse(text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let content):
                    inline(content).lineSpacing(4)
                case .heading(let level, let content):
                    inline(content)
                        .font(
                            level == 1
                                ? .title2.weight(.semibold)
                                : level == 2 ? .headline : .subheadline.weight(.semibold)
                        )
                        .accessibilityAddTraits(.isHeader)
                case .listItem(let marker, let content):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(marker).frame(minWidth: 16, alignment: .trailing)
                        inline(content).frame(maxWidth: .infinity, alignment: .leading)
                    }
                case .quote(let content):
                    inline(content).foregroundStyle(palette.muted)
                        .padding(.leading, 12)
                        .overlay(alignment: .leading) {
                            Rectangle().fill(palette.border).frame(width: 3)
                        }
                case .code(let language, let content):
                    MarkdownCode(language: language, text: content)
                case .table(let table):
                    MarkdownTableView(table: table)
                case .divider:
                    Divider()
                }
            }
        }
    }

    static func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    private func inline(_ text: String) -> Text { Text(Self.attributed(text)) }
}

private struct MarkdownCode: View {
    @Environment(\.palette) private var palette
    let language: String
    let text: String
    @State private var copied = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(language.isEmpty ? "Code" : language).foregroundStyle(palette.muted)
                Spacer()
                Button {
                    UIPasteboard.general.string = text
                    copied = true
                } label: {
                    Label(
                        copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc"
                    )
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel(copied ? "Code copied" : "Copy code")
                .buttonStyle(.plain)
            }
            .font(.caption)
            .padding(.horizontal, 12)
            Divider()
            ScrollView(.horizontal) {
                Text(text).font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled).padding(12)
            }
        }
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 10))
        .task(id: copied) {
            guard copied else { return }
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            copied = false
        }
    }
}

private struct MarkdownTableView: View {
    @Environment(\.palette) private var palette
    @ScaledMetric(relativeTo: .callout) private var columnWidth = 132.0
    let table: MarkdownTable

    var body: some View {
        ScrollView(.horizontal) {
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                row(table.headers, header: true)
                ForEach(Array(table.rows.enumerated()), id: \.offset) { _, cells in
                    row(cells, header: false)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityIdentifier("markdownTable")
    }

    private func row(_ cells: [String], header: Bool) -> some View {
        GridRow {
            ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
                let alignment: Alignment =
                    table.alignments[index] == .trailing
                    ? .trailing
                    : table.alignments[index] == .center ? .center : .leading
                Text(MarkdownText.attributed(cell))
                    .font(.callout.weight(header ? .semibold : .regular))
                    .frame(width: columnWidth, alignment: alignment)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(8)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .background(header ? palette.surface : Color.clear)
                    .overlay { Rectangle().stroke(palette.border, lineWidth: 0.5) }
                    .accessibilityAddTraits(header ? .isHeader : [])
            }
        }
    }
}
