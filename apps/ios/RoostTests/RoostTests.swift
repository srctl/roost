import UIKit
import XCTest

@testable import Roost

final class RoostTests: XCTestCase {
    private let token = "roost_mobile_" + String(repeating: "a", count: 43)
    func testConnectionRejectsInsecureAndAmbiguousAddresses() throws {
        for address in [
            "http://example.com", "https://user:pass@example.com", "https://example.com/app",
            "https://example.com?token=secret", "https://example.com#part", "file:///private/tmp",
        ] {
            XCTAssertThrowsError(try Connection.make(server: address, token: token), address)
        }
        XCTAssertEqual(
            try Connection.make(server: "https://example.com/", token: token).server.host,
            "example.com")
        XCTAssertNoThrow(try Connection.make(server: "http://127.0.0.1:4399", token: token))
        XCTAssertThrowsError(try Connection.make(server: "https://example.com", token: "invalid"))
    }
    @MainActor func testIncrementalMergeUpdatesMessagesWithoutDroppingOlderHistory() throws {
        let agent = Agent(
            id: "agent", name: "Moss", instructions: "Help", character: "moss", model: "fake",
            kind: nil)
        let api = RoostAPI(
            connection: try Connection.make(server: "https://example.com", token: token))
        let model = ConversationModel(agent: agent, conversationId: "agent", api: api)
        func entry(_ id: String, _ position: Int, _ text: String) -> Entry {
            Entry(
                position: position,
                message: Message(
                    id: id, role: "assistant", text: text, title: nil, status: nil, details: nil,
                    files: nil, createdAt: nil))
        }
        model.merge([entry("new", 20, "partial"), entry("old", 10, "history")])
        model.merge([entry("new", 20, "finished"), entry("latest", 30, "next")])
        model.merge([entry("earlier", 1, "older page")])
        XCTAssertEqual(model.entries.map(\.id), ["earlier", "old", "new", "latest"])
        XCTAssertEqual(model.entries[2].message.text, "finished")
    }
    @MainActor func testPendingDraftSurvivesRecreationWithSameSendIdentity() throws {
        let agent = Agent(
            id: UUID().uuidString, name: "Draft", instructions: "Help", character: "moss",
            model: "fake", kind: nil)
        let api = RoostAPI(
            connection: try Connection.make(server: "https://example.com", token: token))
        let model = ConversationModel(agent: agent, conversationId: agent.id, api: api)
        model.draft = "An unconfirmed send"
        model.pending = SendRequest(
            messageId: UUID().uuidString, conversationId: agent.id, text: model.draft,
            attachmentIds: [])
        try model.saveDraft()
        defer {
            try? Drafts.save(
                SavedDraft(text: "", attachments: [], pending: nil), server: api.connection.server,
                agent: agent.id, conversation: agent.id)
        }
        let restored = ConversationModel(agent: agent, conversationId: agent.id, api: api)
        XCTAssertEqual(restored.draft, model.draft)
        XCTAssertEqual(restored.pending, model.pending)
    }
    func testSnapshotDecodesNullRunAndUnknownFields() throws {
        let data = Data(
            #"{"entries":[],"revision":12,"before":null,"threads":[],"busy":false,"runId":null,"status":null,"futureField":true}"#
                .utf8)
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
        XCTAssertEqual(snapshot.revision, 12)
        XCTAssertNil(snapshot.runId)
    }

    func testEveryThemeHasCompleteLightAndDarkPalettes() {
        let tokens: Set<String> = [
            "background", "sidebar", "surface", "selected", "bubble", "foreground",
            "muted", "faint", "border", "accent", "onAccent", "action", "review",
        ]
        XCTAssertEqual(Set(ThemePalette.catalog.keys), Set(ThemePreset.allCases.map(\.rawValue)))
        for theme in ThemePalette.catalog.values {
            XCTAssertEqual(Set(theme.keys), ["light", "dark"])
            for colors in theme.values {
                XCTAssertEqual(Set(colors.keys), tokens)
                for color in colors.values {
                    XCTAssertNotNil(
                        color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression))
                }
            }
        }
    }

    @MainActor func testOptimisticSendSurvivesRestartAndReconcilesWithoutDuplicates() throws {
        let agent = Agent(
            id: UUID().uuidString, name: "Moss", instructions: "", character: "moss",
            model: "fixture", kind: nil)
        let api = RoostAPI(
            connection: try Connection.make(server: "https://example.com", token: token))
        let model = ConversationModel(agent: agent, conversationId: agent.id, api: api)
        defer {
            try? Drafts.save(
                SavedDraft(text: "", attachments: [], pending: nil),
                server: api.connection.server, agent: agent.id, conversation: agent.id)
        }
        model.draft = "A message with an attachment"
        model.attachments = [
            Attachment(id: "file", name: "Garden.txt", mimeType: "text/plain", size: 10)
        ]
        let input = try XCTUnwrap(model.prepareSend())
        XCTAssertEqual(model.displayedEntries.count, 1)
        XCTAssertEqual(model.displayedEntries.first?.message.files?.first?.id, "file")

        let restored = ConversationModel(agent: agent, conversationId: agent.id, api: api)
        XCTAssertEqual(restored.displayedEntries.first?.id, input.messageId)
        restored.draft = "A retry must not change the frozen payload"
        XCTAssertEqual(try restored.prepareSend(), input)
        let serverMessage = try XCTUnwrap(model.outgoingMessage)
        restored.merge([Entry(position: 42, message: serverMessage)])
        XCTAssertEqual(restored.displayedEntries.count, 1)
        XCTAssertEqual(restored.displayedEntries.first?.position, 42)
        XCTAssertEqual(restored.displayedEntries.first?.message.text, input.text)
    }
    func testNoteReconciliationPreservesIndependentEditsAndRejectsConflicts() {
        let first = NoteBlock(id: "first", content: [NoteSpan(text: "Original")])
        let second = NoteBlock(id: "second", content: [NoteSpan(text: "Agent area")])
        var local = first
        local.content = [NoteSpan(text: "My edit", bold: true)]
        var remote = second
        remote.content = [NoteSpan(text: "Agent edit")]
        XCTAssertEqual(
            reconcileNote(
                base: [first, second], local: [local, second], remote: [first, remote]),
            [local, remote])
        XCTAssertNil(
            reconcileNote(
                base: [first], local: [local],
                remote: [NoteBlock(id: "first", content: [NoteSpan(text: "Competing edit")])]))
        XCTAssertNil(
            reconcileNote(base: [first, second], local: [second, first], remote: [first, second]))
        XCTAssertEqual(
            reconcileNote(base: [first, second], local: [second], remote: [first, remote]), [remote]
        )
    }

    func testRichNoteRunsRoundTripWithoutFlatteningFormattingOrLinks() {
        let spans = [
            NoteSpan(text: "Plain "), NoteSpan(text: "strong", bold: true),
            NoteSpan(text: " emphasis", italic: true),
            NoteSpan(text: " link", bold: true, italic: true, href: "https://example.com"),
        ]
        let attributed = NoteDocument.richText(spans)
        XCTAssertEqual(NoteDocument.spans(attributed), spans)
    }

    @MainActor func testNoteRecoveryKeepsExactPendingRequestAcrossRestart() throws {
        let agent = Agent(
            id: UUID().uuidString, name: "Moss", instructions: "Help", character: "moss",
            model: "fixture", kind: nil)
        let api = RoostAPI(
            connection: try Connection.make(server: "https://example.com", token: token))
        let base = NoteSnapshot(
            agentId: agent.id, revision: 4, blocks: [], instructions: "Keep updated", updatedAt: 0)
        let block = NoteBlock(content: [NoteSpan(text: "Unsynced edit")])
        let request = NoteWrite(requestId: UUID().uuidString, revision: 4, blocks: [block])
        let draft = NoteDraft(
            base: base, blocks: [block], pending: PendingNoteWrite(action: "", input: request))
        let url = WorkspaceDrafts.url(api: api, agent: agent.id, key: "note")
        defer { try? FileManager.default.removeItem(at: url) }
        try WorkspaceDrafts.save(draft, to: url)
        let restored = NoteModel(agent: agent, api: api)
        XCTAssertEqual(restored.draft?.pending?.input.requestId, request.requestId)
        XCTAssertEqual(restored.draft?.base.revision, 4)
        XCTAssertEqual(restored.draft?.blocks, [block])
        restored.edit([])
        XCTAssertEqual(restored.draft?.blocks, [block], "Unconfirmed writes must remain frozen")
    }

    func testWorkspaceLinksRejectExecutableSchemesAndEmbeddedCredentials() {
        for value in [
            "javascript:alert(1)", "file:///tmp/file", "https://user:password@example.com",
            "data:text/html,test",
        ] {
            XCTAssertNil(workspaceURL(value))
        }
        XCTAssertNotNil(workspaceURL("https://example.com/preview"))
    }

    func testPreviewLeaseExpiresWithoutFreshNetworkData() throws {
        let json =
            #"{"conversationId":"job","workflow":"review","previewUrl":"https://example.com","previewRevision":"v1","previewAvailability":"running","previewReportedAt":1000,"previewExpiresAt":901000,"latestChanges":"","verification":"","integration":"pending","pullRequests":[]}"#
        let workspace = try JSONDecoder().decode(CodingWorkspace.self, from: Data(json.utf8))
        XCTAssertEqual(workspace.previewState(now: Date(milliseconds: 2000)), "running")
        XCTAssertEqual(workspace.previewState(now: Date(milliseconds: 901000)), "unknown")
        XCTAssertEqual(workspace.previewState(now: Date(milliseconds: 500)), "unknown")
    }

}
