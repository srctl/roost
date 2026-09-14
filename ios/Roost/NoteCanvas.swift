import SwiftUI
import UIKit

// One native text surface: selection can cross paragraphs, the system keyboard
// stays attached during autosave, and formatting never opens a block editor.
struct NoteCanvas: UIViewRepresentable {
    @Environment(\.palette) private var palette
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var blocks: [NoteBlock]
    var editable: Bool
    var onError: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> NoteCanvasTextView {
        let view = NoteCanvasTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.alwaysBounceVertical = true
        view.keyboardDismissMode = .interactive
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 24, left: 18, bottom: 120, right: 18)
        view.accessibilityIdentifier = "noteTextEditor"
        view.accessibilityLabel = "Shared note"
        view.accessibilityHint =
            "Edit anywhere. Type two hashes and a space for a heading, or square brackets and a space for a task."
        view.inputAccessoryView = context.coordinator.toolbar(for: view)
        view.onBlankTap = { [weak coordinator = context.coordinator, weak view] in
            guard let coordinator, let view, view.isEditable else { return }
            var doc = coordinator.document
            if doc.blocks.isEmpty {
                doc.blocks = [NoteBlock()]
            } else if doc.blocks.last?.text.isEmpty == false {
                doc.blocks.append(NoteBlock())
            }
            coordinator.commit(
                doc, selection: NSRange(location: (doc.text as NSString).length, length: 0),
                view: view)
            view.becomeFirstResponder()
        }
        view.onToggle = { [weak coordinator = context.coordinator, weak view] index in
            guard let coordinator, let view, view.isEditable else { return }
            var doc = coordinator.document
            doc.blocks[index].checked = !(doc.blocks[index].checked ?? false)
            coordinator.commit(doc, selection: view.selectedRange, view: view)
        }
        return view
    }
    func updateUIView(_ view: NoteCanvasTextView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        view.isEditable = editable
        view.tintColor = UIColor(palette.accent)
        view.inputAccessoryView?.tintColor = UIColor(palette.accent)
        let color = UIColor(palette.foreground)
        if coordinator.document.blocks != blocks || coordinator.color != color
            || coordinator.typeSize != dynamicTypeSize
        {
            let old = coordinator.document
            let anchor = old.position(view.selectedRange.location)
            let id = old.blocks.indices.contains(anchor.index) ? old.blocks[anchor.index].id : nil
            coordinator.document = NoteDocument(blocks: blocks)
            coordinator.color = color
            coordinator.typeSize = dynamicTypeSize
            var selection = view.selectedRange
            if let id, let index = blocks.firstIndex(where: { $0.id == id }) {
                selection.location =
                    coordinator.document.ranges[index].location
                    + min(anchor.offset, coordinator.document.ranges[index].length)
            }
            // A shared refresh is a new document baseline, not an undoable local
            // keystroke. Local edits already update this coordinator in commit.
            if old.blocks != blocks { view.documentUndo?.removeAllActions() }
            coordinator.render(view, selection: selection)
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: NoteCanvas
        var document = NoteDocument(blocks: [])
        var color = UIColor.label
        var rendering = false
        var pendingInline: [NSAttributedString.Key: Any]?
        var pendingEdit: (NSRange, String)?
        var typeSize: DynamicTypeSize?
        var inline: [NSAttributedString.Key: Any] = [:]
        init(_ parent: NoteCanvas) { self.parent = parent }

        func toolbar(for view: NoteCanvasTextView) -> UIToolbar {
            let bar = UIToolbar()
            bar.sizeToFit()
            bar.isTranslucent = true
            func item(_ icon: String, _ title: String, _ action: @escaping () -> Void)
                -> UIBarButtonItem
            {
                let item = UIBarButtonItem(
                    image: UIImage(systemName: icon),
                    primaryAction: UIAction(title: title) { _ in action() })
                item.accessibilityLabel = title
                return item
            }
            let styles: [(String, String)] = [
                ("Text", "paragraph"), ("Heading 1", "h1"), ("Heading 2", "h2"),
                ("Heading 3", "h3"), ("Bullet list", "bullet"), ("Numbered list", "ordered"),
                ("Checklist", "todo"),
            ]
            let format = UIBarButtonItem(
                image: UIImage(systemName: "textformat"),
                menu: UIMenu(
                    children: styles.map { title, style in
                        UIAction(title: title) { [weak self, weak view] _ in
                            if let self, let view { self.style(style, view: view) }
                        }
                    }))
            format.accessibilityLabel = "Text style"
            bar.items = [
                format,
                item("bold", "Bold") { [weak self, weak view] in
                    if let self, let view { self.format(NoteDocument.bold, view: view) }
                },
                item("italic", "Italic") { [weak self, weak view] in
                    if let self, let view { self.format(NoteDocument.italic, view: view) }
                },
                item("checklist", "Checklist") { [weak self, weak view] in
                    if let self, let view { self.style("todo", view: view) }
                },
                item("link", "Link selected text") { [weak self, weak view] in
                    if let self, let view { self.link(view) }
                },
                item("arrow.uturn.backward", "Undo") { [weak view] in view?.documentUndo?.undo() },
                item("arrow.uturn.forward", "Redo") { [weak view] in view?.documentUndo?.redo() },
                .flexibleSpace(),
                item("keyboard.chevron.compact.down", "Done editing") { [weak view] in
                    view?.resignFirstResponder()
                },
            ]
            return bar
        }
        func render(_ view: NoteCanvasTextView, selection: NSRange) {
            rendering = true
            let value = NSMutableAttributedString()
            for (index, block) in document.blocks.enumerated() {
                let rich = NoteDocument.richText(block.content)
                if index < document.blocks.count - 1 {
                    rich.append(NSAttributedString(string: "\n"))
                }
                let paragraph = paragraphStyle(block)
                rich.addAttributes(
                    [.paragraphStyle: paragraph, .foregroundColor: color],
                    range: NSRange(location: 0, length: rich.length))
                rich.enumerateAttributes(in: NSRange(location: 0, length: rich.length)) {
                    attrs, range, _ in
                    rich.addAttribute(.font, value: self.font(block, attrs), range: range)
                    if let href = attrs[NoteDocument.href] as? String, let url = URL(string: href),
                        ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "")
                    {
                        rich.addAttribute(.link, value: url, range: range)
                    }
                    if block.checked == true {
                        rich.addAttribute(
                            .strikethroughStyle, value: NSUnderlineStyle.single.rawValue,
                            range: range)
                        rich.addAttribute(
                            .foregroundColor, value: UIColor(self.parent.palette.muted),
                            range: range)
                    }
                }
                value.append(rich)
            }
            // Keep UIKit's input and autocorrection context alive. Only replace
            // changed characters; styling is applied to the existing storage.
            view.textStorage.beginEditing()
            let before = view.textStorage.string as NSString
            let after = value.string as NSString
            var prefix = 0
            while prefix < min(before.length, after.length),
                before.character(at: prefix) == after.character(at: prefix)
            { prefix += 1 }
            var suffix = 0
            while suffix < min(before.length, after.length) - prefix,
                before.character(at: before.length - suffix - 1)
                    == after.character(at: after.length - suffix - 1)
            { suffix += 1 }
            if before != after {
                view.textStorage.replaceCharacters(
                    in: NSRange(location: prefix, length: before.length - prefix - suffix),
                    with: value.attributedSubstring(
                        from: NSRange(location: prefix, length: after.length - prefix - suffix)))
            }
            value.enumerateAttributes(in: NSRange(location: 0, length: value.length)) {
                attrs, range, _ in
                view.textStorage.setAttributes(attrs, range: range)
            }
            view.textStorage.endEditing()
            let location = min(selection.location, value.length)
            view.selectedRange = NSRange(
                location: location, length: min(selection.length, value.length - location))
            view.document = document
            view.markerColor = UIColor(parent.palette.accent)
            updateTyping(view)
            view.setNeedsLayout()
            rendering = false
        }
        func font(_ block: NoteBlock, _ attrs: [NSAttributedString.Key: Any]) -> UIFont {
            let style: UIFont.TextStyle =
                block.type == "heading"
                ? (block.level == 1 ? .title1 : block.level == 3 ? .headline : .title2) : .body
            let base = UIFont.preferredFont(forTextStyle: style)
            var traits: UIFontDescriptor.SymbolicTraits = []
            if block.type == "heading" || attrs[NoteDocument.bold] as? Bool == true {
                traits.insert(.traitBold)
            }
            if attrs[NoteDocument.italic] as? Bool == true { traits.insert(.traitItalic) }
            return UIFont(
                descriptor: base.fontDescriptor.withSymbolicTraits(traits) ?? base.fontDescriptor,
                size: 0)
        }
        private func paragraphStyle(_ block: NoteBlock) -> NSParagraphStyle {
            let paragraph = NSMutableParagraphStyle()
            paragraph.paragraphSpacing = block.type == "heading" ? 16 : 12
            paragraph.lineSpacing = 4
            if ["bullet", "ordered", "todo"].contains(block.type) {
                paragraph.firstLineHeadIndent = 28
                paragraph.headIndent = 28
            }
            return paragraph
        }
        func updateTyping(_ view: UITextView) {
            let index = document.position(view.selectedRange.location).index
            let block =
                document.blocks.indices.contains(index) ? document.blocks[index] : NoteBlock()
            view.typingAttributes = inline.merging([
                .font: font(block, inline), .foregroundColor: color,
                .paragraphStyle: paragraphStyle(block),
            ]) { _, new in new }
        }
        func commit(_ next: NoteDocument, selection: NSRange, view: NoteCanvasTextView) {
            guard next.valid else {
                parent.onError(
                    "This note is too large. Keep it under 500 blocks and 200,000 characters.")
                render(view, selection: view.selectedRange)
                return
            }
            let previous = document
            let oldSelection = view.selectedRange
            let oldInline = inline
            if next.blocks != document.blocks {
                view.documentUndo?
                    .registerUndo(withTarget: self) { [weak view] coordinator in
                        guard let view else { return }
                        coordinator.inline = oldInline
                        coordinator.commit(previous, selection: oldSelection, view: view)
                    }
                view.documentUndo?.setActionName("Edit note")
            }
            document = next
            render(view, selection: selection)
            parent.blocks = next.blocks
            if view.isFirstResponder { view.scrollRangeToVisible(view.selectedRange) }
        }
        func textView(
            _ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String
        ) -> Bool {
            guard let view = textView as? NoteCanvasTextView else { return false }
            // Let marked text settle before rebuilding attributed paragraphs.
            if view.markedTextRange != nil || view.text != document.text { return true }
            var next = document
            let start = next.position(range.location)
            if text.isEmpty, range.length == 1, start.index + 1 < next.blocks.count,
                range.location == NSMaxRange(next.ranges[start.index]),
                next.blocks[start.index + 1].type != "paragraph"
            {
                next.blocks[start.index + 1].type = "paragraph"
                next.blocks[start.index + 1].level = nil
                next.blocks[start.index + 1].checked = nil
                commit(
                    next, selection: NSRange(location: range.location + 1, length: 0), view: view)
                return false
            }
            pendingInline = inline
            pendingEdit = (range, text)
            return true
        }
        func textViewDidChange(_ textView: UITextView) {
            guard !rendering, textView.markedTextRange == nil,
                let view = textView as? NoteCanvasTextView
            else { return }
            let before = document.text as NSString
            let after = (view.text ?? "") as NSString
            var prefix = 0
            while prefix < min(before.length, after.length),
                before.character(at: prefix) == after.character(at: prefix)
            { prefix += 1 }
            var suffix = 0
            while suffix < min(before.length, after.length) - prefix,
                before.character(at: before.length - suffix - 1)
                    == after.character(at: after.length - suffix - 1)
            { suffix += 1 }
            var next = document
            let nativeSelection = view.selectedRange
            var replacement = after.substring(
                with: NSRange(location: prefix, length: after.length - prefix - suffix))
            var changedRange = NSRange(location: prefix, length: before.length - prefix - suffix)
            // Identical adjacent characters or empty paragraphs make a text diff
            // ambiguous. Prefer UIKit's exact edit range when it still matches.
            if let (range, text) = pendingEdit, NSMaxRange(range) <= before.length,
                before.replacingCharacters(in: range, with: text) == after as String
            {
                changedRange = range
                replacement = text
            }
            pendingEdit = nil
            _ = next.replace(
                changedRange,
                with: replacement, attributes: pendingInline ?? inline,
                shortcuts: !replacement.isEmpty)
            pendingInline = nil
            if replacement.contains("\n") { inline = [:] }
            let caret = max(
                0, nativeSelection.location + (next.text as NSString).length - after.length)
            commit(
                next, selection: NSRange(location: caret, length: nativeSelection.length),
                view: view)
        }
        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !rendering, pendingInline == nil, textView.markedTextRange == nil else { return }
            let position = document.position(textView.selectedRange.location)
            inline = [:]
            if document.blocks.indices.contains(position.index) {
                let rich = NoteDocument.richText(document.blocks[position.index].content)
                if rich.length > 0 {
                    inline = rich.attributes(
                        at: min(max(0, position.offset - 1), rich.length - 1), effectiveRange: nil)
                }
            }
            updateTyping(textView)
        }
        func style(_ style: String, view: NoteCanvasTextView) {
            guard view.isEditable else { return }
            var next = document
            if next.blocks.isEmpty { next.blocks = [NoteBlock()] }
            let start = next.position(view.selectedRange.location).index
            let end =
                next.position(max(view.selectedRange.location, NSMaxRange(view.selectedRange) - 1))
                .index
            for index in start...end {
                next.blocks[index].type = style.hasPrefix("h") ? "heading" : style
                next.blocks[index].level = style.hasPrefix("h") ? Int(style.dropFirst()) : nil
                next.blocks[index].checked = style == "todo" ? false : nil
            }
            commit(next, selection: view.selectedRange, view: view)
        }
        func format(_ key: NSAttributedString.Key, value: Any? = nil, view: NoteCanvasTextView) {
            guard view.isEditable else { return }
            let range = view.selectedRange
            if range.length == 0 {
                if inline[key] != nil {
                    inline.removeValue(forKey: key)
                } else {
                    inline[key] = value ?? true
                }
                updateTyping(view)
                return
            }
            var next = document
            let position = next.position(range.location)
            let first = NoteDocument.richText(next.blocks[position.index].content)
            let selectedAttribute =
                position.offset < first.length
                ? first.attribute(key, at: position.offset, effectiveRange: nil) : nil
            let remove = value == nil && selectedAttribute != nil
            for (index, blockRange) in next.ranges.enumerated() {
                let overlap = NSIntersectionRange(range, blockRange)
                if overlap.length == 0 { continue }
                let rich = NoteDocument.richText(next.blocks[index].content)
                let local = NSRange(
                    location: overlap.location - blockRange.location, length: overlap.length)
                if remove {
                    rich.removeAttribute(key, range: local)
                } else {
                    rich.addAttribute(key, value: value ?? true, range: local)
                }
                next.blocks[index].content = NoteDocument.spans(rich)
            }
            commit(next, selection: range, view: view)
        }
        func link(_ view: NoteCanvasTextView) {
            guard view.selectedRange.length > 0 else {
                UIAccessibility.post(
                    notification: .announcement, argument: "Select text to add a link.")
                return
            }
            let alert = UIAlertController(
                title: "Link selected text", message: "Use an https, http, or mailto address.",
                preferredStyle: .alert)
            alert.addTextField { field in
                field.placeholder = "https://example.com"
                field.keyboardType = .URL
                field.autocapitalizationType = .none
            }
            alert.addAction(
                UIAlertAction(title: "Cancel", style: .cancel) { _ in view.becomeFirstResponder() })
            alert.addAction(
                UIAlertAction(title: "Apply", style: .default) { [weak self] _ in
                    if let href = alert.textFields?.first?.text, let url = URL(string: href),
                        ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? ""),
                        !href.contains(where: \.isWhitespace)
                    {
                        self?.format(NoteDocument.href, value: href, view: view)
                    } else {
                        self?.parent.onError("Use an https, http, or mailto address for the link.")
                    }
                    view.becomeFirstResponder()
                })
            var controller = view.window?.rootViewController
            while let presented = controller?.presentedViewController { controller = presented }
            controller?.present(alert, animated: true)
        }
    }
}

final class NoteCanvasTextView: UITextView, UIGestureRecognizerDelegate {
    // Native character-range undo becomes invalid after Markdown transforms.
    // Snapshot history restores the full document, IDs, styles and selection.
    let documentUndo: UndoManager? = {
        let history = UndoManager()
        history.levelsOfUndo = 100
        return history
    }()
    override var undoManager: UndoManager? { nil }
    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(input: "z", modifierFlags: .command, action: #selector(undoDocument)),
            UIKeyCommand(
                input: "z", modifierFlags: [.command, .shift], action: #selector(redoDocument)),
        ]
    }
    @objc private func undoDocument() { documentUndo?.undo() }
    @objc private func redoDocument() { documentUndo?.redo() }
    var document = NoteDocument(blocks: [])
    var markerColor = UIColor.tintColor
    var onToggle: ((Int) -> Void)?
    var onBlankTap: (() -> Void)?
    private var markers: [UIView] = []
    private var markerBlocks: [NoteBlock] = []
    private var markerWidth: CGFloat = 0
    private var markerFontSize: CGFloat = 0
    private var previousMarkerColor: UIColor?
    private var markerEditable = false
    private let placeholder = UILabel()
    private lazy var blankTap = UITapGestureRecognizer(target: self, action: #selector(tappedBlank))
    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        blankTap.delegate = self
        addGestureRecognizer(blankTap)
        placeholder.text = "Start writing…\nUse ## for headings or [] for tasks."
        placeholder.numberOfLines = 0
        placeholder.font = .preferredFont(forTextStyle: .body)
        placeholder.textColor = .placeholderText
        placeholder.isUserInteractionEnabled = false
        addSubview(placeholder)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        placeholder.frame = CGRect(x: 23, y: 24, width: bounds.width - 46, height: 68)
        placeholder.isHidden = !text.isEmpty
        let fontSize = UIFont.preferredFont(forTextStyle: .body).pointSize
        guard
            markerBlocks != document.blocks || markerWidth != bounds.width
                || markerFontSize != fontSize || previousMarkerColor != markerColor
                || markerEditable != isEditable
        else { return }
        markerBlocks = document.blocks
        markerWidth = bounds.width
        markerFontSize = fontSize
        previousMarkerColor = markerColor
        markerEditable = isEditable
        for marker in markers { marker.removeFromSuperview() }
        markers = []
        layoutManager.ensureLayout(for: textContainer)
        var number = 0
        var actions: [UIAccessibilityCustomAction] = []
        for (index, block) in document.blocks.enumerated() {
            number = block.type == "ordered" ? number + 1 : 0
            guard ["todo", "bullet", "ordered"].contains(block.type) else { continue }
            let range = document.ranges[index]
            let rect: CGRect
            if range.location < textStorage.length {
                let glyph = layoutManager.glyphIndexForCharacter(at: range.location)
                rect = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil)
            } else {
                rect = layoutManager.extraLineFragmentRect
            }
            let frame = CGRect(
                x: textContainerInset.left - 9, y: rect.minY + textContainerInset.top - 10,
                width: 44, height: max(44, rect.height + 20))
            if block.type == "todo" {
                let button = UIButton(type: .system)
                button.frame = frame
                button.tintColor = markerColor
                button.setImage(
                    UIImage(
                        systemName: block.checked == true ? "checkmark.square.fill" : "square",
                        withConfiguration: UIImage.SymbolConfiguration(
                            pointSize: 19, weight: .regular)), for: .normal)
                button.accessibilityLabel =
                    (block.checked == true ? "Mark incomplete: " : "Complete task: ") + block.text
                button.accessibilityIdentifier = "note-todo-\(index)"
                button.addAction(
                    UIAction { [weak self] _ in self?.onToggle?(index) }, for: .touchUpInside)
                button.isEnabled = isEditable
                addSubview(button)
                markers.append(button)
                actions.append(
                    UIAccessibilityCustomAction(name: button.accessibilityLabel ?? "Toggle task") {
                        [weak self] _ in
                        self?.onToggle?(index)
                        return true
                    })
            } else {
                let label = UILabel(frame: frame)
                label.text = block.type == "bullet" ? "•" : "\(number)."
                label.textAlignment = .center
                label.font = .preferredFont(forTextStyle: .body)
                label.textColor = markerColor
                label.isAccessibilityElement = false
                addSubview(label)
                markers.append(label)
            }
        }
        accessibilityCustomActions = actions
    }
    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === blankTap, isEditable else { return false }
        let point = gestureRecognizer.location(in: self)
        let bottom = layoutManager.usedRect(for: textContainer).maxY + textContainerInset.top
        return point.y > bottom + 18 || text.isEmpty
    }
    @objc private func tappedBlank() { onBlankTap?() }
}
