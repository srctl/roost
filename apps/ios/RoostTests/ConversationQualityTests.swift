import UIKit
import XCTest

@testable import Roost

final class ConversationQualityTests: XCTestCase {
    @MainActor private func model() throws -> ConversationModel {
        let agent = Agent(
            id: UUID().uuidString, name: "Moss", instructions: "", character: "moss",
            model: "fixture", kind: nil)
        return ConversationModel(
            agent: agent, conversationId: agent.id,
            api: RoostAPI(
                connection:
                    try Connection.make(
                        server: "https://example.com",
                        token: "roost_mobile_" + String(repeating: "a", count: 43))))
    }

    @MainActor private func clear(_ model: ConversationModel) {
        try? Drafts.save(
            SavedDraft(text: "", attachments: [], pending: nil),
            server: model.api.connection.server,
            agent: model.agent.id, conversation: model.conversationId)
    }

    @MainActor func testServerReceiptUnlocksRestoredPendingMessageAndPersistsRecovery() throws {
        let original = try model()
        defer { clear(original) }
        original.draft = "  Received despite a lost response  "
        original.attachments = [
            Attachment(id: "photo", name: "Photo.png", mimeType: "image/png", size: 100)
        ]
        let request = try XCTUnwrap(original.prepareSend())
        let restored = ConversationModel(
            agent: original.agent, conversationId: original.conversationId, api: original.api)
        XCTAssertTrue(restored.deliveryUnconfirmed)
        let message = try XCTUnwrap(restored.outgoingMessage)
        restored.merge([Entry(position: 15, message: message)])
        XCTAssertNil(restored.pending)
        XCTAssertFalse(restored.deliveryUnconfirmed)
        XCTAssertTrue(restored.draft.isEmpty)
        XCTAssertTrue(restored.attachments.isEmpty)
        XCTAssertEqual(restored.displayedEntries.map(\.id), [request.messageId])
        let reopened = ConversationModel(
            agent: original.agent, conversationId: original.conversationId, api: original.api)
        XCTAssertNil(reopened.pending)
        XCTAssertTrue(reopened.draft.isEmpty)
    }

    @MainActor func testReceiptPreservesIndependentNewDraftAndAttachments() throws {
        let model = try model()
        defer { clear(model) }
        model.draft = "First message"
        model.attachments = [
            Attachment(id: "first", name: "a.png", mimeType: "image/png", size: 100)
        ]
        _ = try model.prepareSend()
        let outgoing = try XCTUnwrap(model.outgoingMessage)
        model.draft = "My next message"
        model.attachments.append(
            Attachment(id: "second", name: "b.png", mimeType: "image/png", size: 100))
        model.merge([Entry(position: 1, message: outgoing)])
        XCTAssertEqual(model.draft, "My next message")
        XCTAssertEqual(model.attachments.map(\.id), ["second"])
    }

    @MainActor func testAttachmentOnlyFollowupCanSendDuringActiveResponse() throws {
        let model = try model()
        model.busy = true
        model.attachments = [
            Attachment(id: "photo", name: "Photo.png", mimeType: "image/png", size: 100)
        ]
        XCTAssertTrue(model.hasDraft)
        XCTAssertTrue(model.canSend)
        model.uploading = true
        XCTAssertFalse(model.canSend)
    }

    @MainActor func testOverlongDraftIsEditableAndDoesNotCreatePendingSend() throws {
        let model = try model()
        model.draft = String(repeating: "a", count: 32_001)
        XCTAssertFalse(model.canSend)
        XCTAssertThrowsError(try model.prepareSend())
        XCTAssertNil(model.pending)
        XCTAssertEqual(model.draft.count, 32_001)
    }

    @MainActor func testCachedConversationUsesRenamedAgentWithoutLosingDraft() throws {
        let original = try model()
        let app = AppModel()
        app.connection = original.api.connection
        let cached = try XCTUnwrap(app.conversation(agent: original.agent))
        cached.draft = "Keep my work"
        let renamed = Agent(
            id: original.agent.id, name: "Fern", instructions: "Updated", character: "fern",
            model: "fixture", kind: nil)
        app.agents = [renamed]
        let refreshed = try XCTUnwrap(app.conversation(agent: renamed))
        XCTAssertTrue(cached === refreshed)
        XCTAssertEqual(refreshed.agent.name, "Fern")
        XCTAssertEqual(refreshed.draft, "Keep my work")
    }

    @MainActor func testLateSendSuccessCannotRestoreDraftAfterSessionEnds() async throws {
        try await verifyRetiredSend(fails: false)
    }

    @MainActor func testLateSendFailureCannotRestoreDraftAfterSessionEnds() async throws {
        try await verifyRetiredSend(fails: true)
    }

    @MainActor private func verifyRetiredSend(fails: Bool) async throws {
        let original = try model()
        let started = AsyncStream<Void>.makeStream()
        var release: CheckedContinuation<Void, Error>?
        let sending = ConversationModel(
            agent: original.agent, conversationId: original.conversationId, api: original.api,
            sendMessage: { _ in
                try await withCheckedThrowingContinuation { continuation in
                    release = continuation
                    started.continuation.yield(())
                }
            })
        defer {
            clear(sending)
            started.continuation.finish()
        }
        sending.draft = "Waiting for the server"
        let task = Task { await sending.send() }
        var observer = started.stream.makeAsyncIterator()
        _ = await observer.next()
        let pending = try XCTUnwrap(sending.pending)
        let outgoing = try XCTUnwrap(sending.outgoingMessage)
        sending.invalidateSession()
        clear(sending)
        if fails {
            release?.resume(throwing: URLError(.networkConnectionLost))
        } else {
            release?.resume(returning: ())
        }
        await task.value
        sending.merge([Entry(position: 1, message: outgoing)])
        sending.persistDraft()
        XCTAssertNil(
            try Drafts.load(
                server: sending.api.connection.server, agent: sending.agent.id,
                conversation: sending.conversationId))
        XCTAssertEqual(sending.pending?.messageId, pending.messageId)
        XCTAssertTrue(sending.entries.isEmpty)
        XCTAssertNil(sending.error)
        XCTAssertFalse(sending.canSend)
        XCTAssertFalse(sending.sending)
        XCTAssertThrowsError(try sending.prepareSend())
        XCTAssertThrowsError(try sending.saveDraft())
    }

    func testMarkdownPreservesFencedCodeAndInlineBackticks() {
        XCTAssertEqual(
            MarkdownBlocks.parse("Use `code` here.\n\n````swift\nlet fence = \"```\"\n````"),
            [
                .paragraph("Use `code` here."),
                .code(language: "swift", text: "let fence = \"```\""),
            ])
        XCTAssertEqual(
            MarkdownBlocks.parse("~~~text\nunfinished\n  indentation"),
            [
                .code(language: "text", text: "unfinished\n  indentation")
            ])
    }

    func testMarkdownTableParsesAlignmentEscapedPipesAndCodeCells() {
        let text = "| Item | Command |\n| :--- | ---: |\n| a\\|b | `x|y` |\n| Only one |"
        XCTAssertEqual(
            MarkdownBlocks.parse(text),
            [
                .table(
                    MarkdownTable(
                        headers: ["Item", "Command"], alignments: [.leading, .trailing],
                        rows: [["a|b", "`x|y`"], ["Only one", ""]]))
            ])
        XCTAssertEqual(MarkdownBlocks.tableCells("| ``x`|y`` | value |"), ["``x`|y``", "value"])
    }

    func testMarkdownHeadingsListsQuotesAndPlainPipesRemainReadable() {
        XCTAssertEqual(
            MarkdownBlocks.parse(
                "## Plan\n- Water plants\n1. Check soil\n- [x] Done\n> Take your time\n\na | b\nc | d"
            ),
            [
                .heading(2, "Plan"), .listItem("•", "Water plants"), .listItem("1.", "Check soil"),
                .listItem("✓", "Done"), .quote("Take your time"), .paragraph("a | b\nc | d"),
            ])
    }

    @MainActor func testImagePreviewDownsamplesAndRejectsNonImageBytes() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 2400, height: 1200), format: format)
        let data = renderer.pngData { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2400, height: 1200))
        }
        let preview = try ImageThumbnailStore.decode(data)
        XCTAssertLessThanOrEqual(max(preview.size.width, preview.size.height), 1000)
        XCTAssertEqual(preview.size.width / preview.size.height, 2, accuracy: 0.01)
        XCTAssertThrowsError(try ImageThumbnailStore.decode(Data("not an image".utf8)))
    }
}
