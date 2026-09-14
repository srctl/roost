import Foundation

// The editable string uses paragraph separators between blocks and a soft line
// separator inside spans. IDs and block styles live in the document, not in
// visible Markdown or hidden characters that can leak into a copied note.
struct NoteDocument {
    var blocks: [NoteBlock]
    var text: String {
        blocks.map { $0.text.replacingOccurrences(of: "\n", with: "\u{2028}") }
            .joined(separator: "\n")
    }
    var ranges: [NSRange] {
        var offset = 0
        return blocks.map { block in
            let range = NSRange(location: offset, length: (block.text as NSString).length)
            offset += range.length + 1
            return range
        }
    }
    func position(_ offset: Int) -> (index: Int, offset: Int) {
        let ranges = ranges
        for (index, range) in ranges.enumerated() where offset <= NSMaxRange(range) {
            return (index, max(0, offset - range.location))
        }
        return (max(0, blocks.count - 1), ranges.last?.length ?? 0)
    }
    static let bold = NSAttributedString.Key("roost.bold")
    static let italic = NSAttributedString.Key("roost.italic")
    static let href = NSAttributedString.Key("roost.href")

    static func richText(_ spans: [NoteSpan]) -> NSMutableAttributedString {
        let value = NSMutableAttributedString()
        for span in spans {
            var attributes: [NSAttributedString.Key: Any] = [:]
            if span.bold == true { attributes[bold] = true }
            if span.italic == true { attributes[italic] = true }
            if let url = span.href { attributes[href] = url }
            value.append(
                NSAttributedString(
                    string: span.text.replacingOccurrences(of: "\n", with: "\u{2028}"),
                    attributes: attributes))
        }
        return value
    }
    static func spans(_ value: NSAttributedString) -> [NoteSpan] {
        var spans: [NoteSpan] = []
        value.enumerateAttributes(in: NSRange(location: 0, length: value.length)) {
            attrs, range, _ in
            let span = NoteSpan(
                text: (value.string as NSString).substring(with: range)
                    .replacingOccurrences(of: "\u{2028}", with: "\n"),
                bold: attrs[bold] as? Bool == true ? true : nil,
                italic: attrs[italic] as? Bool == true ? true : nil, href: attrs[href] as? String)
            if let last = spans.last, last.bold == span.bold, last.italic == span.italic,
                last.href == span.href
            {
                spans[spans.count - 1].text += span.text
            } else {
                spans.append(span)
            }
        }
        return spans
    }

    // UTF-16 ranges match UIKit selection, including emoji and composed text.
    // Only touched blocks change; IDs of the rest survive editing and autosave.
    @discardableResult mutating func replace(
        _ range: NSRange, with replacement: String,
        attributes: [NSAttributedString.Key: Any] = [:], shortcuts: Bool = true
    ) -> Int {
        if blocks.isEmpty { blocks = [NoteBlock()] }
        let start = position(range.location)
        let end = position(NSMaxRange(range))
        let oldRanges = ranges
        let first = blocks[start.index]
        let last = blocks[end.index]
        if replacement == "\n", range.length == 0, first.text.isEmpty, first.type != "paragraph" {
            blocks[start.index].type = "paragraph"
            blocks[start.index].level = nil
            blocks[start.index].checked = nil
            return range.location
        }
        let value = Self.richText(first.content)
            .attributedSubstring(from: NSRange(location: 0, length: start.offset))
        let joined = NSMutableAttributedString(attributedString: value)
        joined.append(
            NSAttributedString(
                string: replacement.replacingOccurrences(of: "\r\n", with: "\n")
                    .replacingOccurrences(of: "\r", with: "\n"), attributes: attributes))
        let suffix = Self.richText(last.content)
        joined.append(
            suffix.attributedSubstring(
                from: NSRange(location: end.offset, length: suffix.length - end.offset)))
        let lines = joined.string.components(separatedBy: "\n")
        var offset = 0
        var changed: [NoteBlock] = []
        var caret = range.location + (replacement as NSString).length
        for (index, line) in lines.enumerated() {
            var block: NoteBlock
            if index == 0 {
                block = first
            } else if index == lines.count - 1 && end.index != start.index {
                block = last
            } else {
                let list = ["bullet", "ordered", "todo"].contains(first.type)
                block = NoteBlock(
                    type: list ? first.type : "paragraph",
                    checked: first.type == "todo" ? false : nil)
            }
            let length = (line as NSString).length
            let rich = NSMutableAttributedString(
                attributedString: joined.attributedSubstring(
                    from: NSRange(location: offset, length: length)))
            let globalStart =
                oldRanges[start.index].location
                + changed.reduce(0) { $0 + ($1.text as NSString).length + 1 }
            if shortcuts {
                let removed = Self.applyBlockShortcut(&block, text: rich)
                if globalStart < caret { caret -= min(removed, caret - globalStart) }
                Self.applyInlineShortcuts(rich, caret: &caret, start: globalStart)
            }
            block.content = Self.spans(rich)
            changed.append(block)
            offset += length + 1
        }
        blocks.replaceSubrange(start.index...end.index, with: changed)
        return min(max(0, caret), (text as NSString).length)
    }

    private static func applyBlockShortcut(
        _ block: inout NoteBlock, text: NSMutableAttributedString
    ) -> Int {
        guard block.type == "paragraph" else { return 0 }
        let rules: [(String, String, Int?, Bool?)] = [
            ("### ", "heading", 3, nil), ("## ", "heading", 2, nil), ("# ", "heading", 1, nil),
            ("[] ", "todo", nil, false), ("[ ] ", "todo", nil, false), ("[x] ", "todo", nil, true),
            ("- [ ] ", "todo", nil, false), ("- [x] ", "todo", nil, true),
            ("- ", "bullet", nil, nil), ("* ", "bullet", nil, nil), ("1. ", "ordered", nil, nil),
        ]
        guard let rule = rules.first(where: { text.string.hasPrefix($0.0) }) else { return 0 }
        block.type = rule.1
        block.level = rule.2
        block.checked = rule.3
        let length = (rule.0 as NSString).length
        text.deleteCharacters(in: NSRange(location: 0, length: length))
        return length
    }
    private static func applyInlineShortcuts(
        _ text: NSMutableAttributedString, caret: inout Int, start: Int
    ) {
        // Process innermost runs without flattening the surrounding rich text.
        let rules: [(String, NSAttributedString.Key)] = [
            (#"\*\*([^*\n]+)\*\*"#, bold), (#"(?<!\*)\*([^*\n]+)\*(?!\*)"#, italic),
            (#"\[([^\]\n]+)\]\(([^\s)]+)\)"#, href),
        ]
        for (pattern, key) in rules {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            for match
                in regex.matches(in: text.string, range: NSRange(location: 0, length: text.length))
                .reversed()
            {
                let inner = NSMutableAttributedString(
                    attributedString: text.attributedSubstring(from: match.range(at: 1)))
                if key == href {
                    let link = (text.string as NSString).substring(with: match.range(at: 2))
                    guard let url = URL(string: link),
                        ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "")
                    else { continue }
                    inner.addAttribute(
                        key, value: link, range: NSRange(location: 0, length: inner.length))
                } else {
                    inner.addAttribute(
                        key, value: true, range: NSRange(location: 0, length: inner.length))
                }
                let removed = match.range.length - inner.length
                text.replaceCharacters(in: match.range, with: inner)
                if caret >= start + NSMaxRange(match.range) { caret -= removed }
            }
        }
    }
    var valid: Bool {
        guard blocks.count <= 500,
            blocks.allSatisfy({
                $0.content.count <= 500 && $0.content.allSatisfy { $0.text.utf16.count <= 20_000 }
            }),
            let data = try? JSONEncoder().encode(blocks),
            let json = String(data: data, encoding: .utf8)
        else { return false }
        return json.utf16.count <= 200_000
    }
}
