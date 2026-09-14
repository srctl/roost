import SwiftUI
import XCTest

@testable import Roost

final class NoteDocumentTests: XCTestCase {
    func testTypingMarkdownCreatesStyledBlocksWithoutStoringPrefixes() {
        var doc = NoteDocument(blocks: [])
        var caret = 0
        for character in "## Garden plans\n[] Water basil\n" {
            caret = doc.replace(NSRange(location: caret, length: 0), with: String(character))
        }
        XCTAssertEqual(doc.blocks.map(\.type), ["heading", "todo", "todo"])
        XCTAssertEqual(doc.blocks.map(\.text), ["Garden plans", "Water basil", ""])
        XCTAssertEqual(doc.blocks[0].level, 2)
        XCTAssertEqual(doc.blocks[1].checked, false)
        caret = doc.replace(NSRange(location: caret, length: 0), with: "\n")
        XCTAssertEqual(doc.blocks.last?.type, "paragraph", "Return exits an empty list")
        XCTAssertEqual(caret, (doc.text as NSString).length)
    }
    func testEditsAcrossParagraphsPreserveUnchangedIDsAndRichSuffix() {
        let before = NoteBlock(content: [NoteSpan(text: "Before")])
        let first = NoteBlock(content: [NoteSpan(text: "Hello 🌱", bold: true)])
        let last = NoteBlock(content: [NoteSpan(text: "beautiful garden", italic: true)])
        let after = NoteBlock(content: [NoteSpan(text: "After")])
        var doc = NoteDocument(blocks: [before, first, last, after])
        let start = doc.ranges[1].location + 6
        let end = doc.ranges[2].location + 10
        let caret = doc.replace(NSRange(location: start, length: end - start), with: "our ")
        XCTAssertEqual(doc.blocks.map(\.text), ["Before", "Hello our garden", "After"])
        XCTAssertEqual(doc.blocks.map(\.id), [before.id, first.id, after.id])
        XCTAssertEqual(doc.blocks[1].content.last, NoteSpan(text: "garden", italic: true))
        XCTAssertEqual(caret, start + 4)
    }
    func testSoftBreaksAndInlineMarksRoundTripWithoutTurningHeadingIntoBoldSpan() {
        let spans = [
            NoteSpan(text: "Two\nlines", italic: true),
            NoteSpan(text: " link", href: "https://example.com"),
        ]
        let block = NoteBlock(type: "heading", content: spans, level: 2)
        var doc = NoteDocument(blocks: [block])
        XCTAssertEqual(doc.text, "Two\u{2028}lines link")
        _ = doc.replace(NSRange(location: 3, length: 0), with: " more")
        XCTAssertEqual(doc.blocks.count, 1)
        XCTAssertEqual(doc.blocks[0].type, "heading")
        XCTAssertEqual(doc.blocks[0].content.last?.href, "https://example.com")
        XCTAssertFalse(doc.blocks[0].content.contains { $0.bold == true })
    }
    func testMarkdownPasteAndInlineFormatting() {
        var doc = NoteDocument(blocks: [])
        let caret = doc.replace(
            NSRange(location: 0, length: 0),
            with:
                "# Plan\nA **bold** and *gentle* [link](https://example.com)\n- [x] Done\n1. First")
        XCTAssertEqual(doc.blocks.map(\.type), ["heading", "paragraph", "todo", "ordered"])
        XCTAssertEqual(doc.blocks[1].text, "A bold and gentle link")
        XCTAssertTrue(doc.blocks[1].content.contains { $0.text == "bold" && $0.bold == true })
        XCTAssertTrue(doc.blocks[1].content.contains { $0.text == "gentle" && $0.italic == true })
        XCTAssertEqual(doc.blocks[1].content.last?.href, "https://example.com")
        XCTAssertEqual(doc.blocks[2].checked, true)
        XCTAssertEqual(caret, (doc.text as NSString).length)
    }
    func testReturnSplitsHeadingAndPreservesFollowingBlocks() {
        let heading = NoteBlock(
            type: "heading", content: [NoteSpan(text: "TodayTomorrow")], level: 2)
        let untouched = NoteBlock(content: [NoteSpan(text: "Keep")])
        var doc = NoteDocument(blocks: [heading, untouched])
        let caret = doc.replace(NSRange(location: 5, length: 0), with: "\n")
        XCTAssertEqual(doc.blocks.map(\.text), ["Today", "Tomorrow", "Keep"])
        XCTAssertEqual(doc.blocks.map(\.type), ["heading", "paragraph", "paragraph"])
        XCTAssertEqual(doc.blocks[0].id, heading.id)
        XCTAssertEqual(doc.blocks[2], untouched)
        XCTAssertEqual(caret, 6)
        _ = doc.replace(NSRange(location: 5, length: 1), with: "", shortcuts: false)
        XCTAssertEqual(doc.blocks, [heading, untouched])
    }
    func testDocumentLimitsRejectOversizePaste() {
        XCTAssertFalse(NoteDocument(blocks: (0..<501).map { _ in NoteBlock() }).valid)
        XCTAssertFalse(
            NoteDocument(blocks: [
                NoteBlock(content: [NoteSpan(text: String(repeating: "a", count: 20_001))])
            ])
            .valid)
        XCTAssertTrue(
            NoteDocument(blocks: [NoteBlock(content: [NoteSpan(text: "A reasonable note")])]).valid)
    }
    @MainActor func testNativeReturnUsesExactBlockWhenAdjacentParagraphsAreEmpty() {
        let heading = NoteBlock(type: "heading", level: 2)
        let last = NoteBlock()
        var blocks = [NoteBlock(content: [NoteSpan(text: "A")]), heading, last]
        let canvas = NoteCanvas(
            blocks: Binding(get: { blocks }, set: { blocks = $0 }), editable: true,
            onError: { XCTFail($0) })
        let coordinator = NoteCanvas.Coordinator(canvas)
        let view = NoteCanvasTextView()
        coordinator.document = NoteDocument(blocks: blocks)
        coordinator.render(view, selection: NSRange(location: 2, length: 0))
        XCTAssertTrue(
            coordinator.textView(
                view, shouldChangeTextIn: NSRange(location: 2, length: 0), replacementText: "\n"))
        view.textStorage.replaceCharacters(in: NSRange(location: 2, length: 0), with: "\n")
        view.selectedRange = NSRange(location: 3, length: 0)
        coordinator.textViewDidChange(view)
        XCTAssertEqual(blocks.count, 3)
        XCTAssertEqual(blocks[1].id, heading.id)
        XCTAssertEqual(blocks[1].type, "paragraph")
        XCTAssertEqual(blocks[2], last)
        XCTAssertEqual(view.selectedRange.location, 2)
    }

    @MainActor func testEmptyChecklistKeepsCaretIndentedBeforeTyping() {
        var blocks = [NoteBlock(type: "todo", checked: false)]
        let canvas = NoteCanvas(
            blocks: Binding(get: { blocks }, set: { blocks = $0 }), editable: true,
            onError: { XCTFail($0) })
        let coordinator = NoteCanvas.Coordinator(canvas)
        let view = NoteCanvasTextView()
        coordinator.document = NoteDocument(blocks: blocks)
        coordinator.render(view, selection: NSRange(location: 0, length: 0))
        XCTAssertEqual(
            (view.typingAttributes[.paragraphStyle] as? NSParagraphStyle)?.firstLineHeadIndent, 28)
    }

}
