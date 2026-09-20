import JuxiSwiftUI
import XCTest

@testable import Roost

final class ChatDashboardTests: XCTestCase {
    func testExplicitDashboardReferenceDecodesAndMalformedUIKeepsOrdinaryText() throws {
        for ui in [
            #"{"type":"dashboard","key":"my-tasks"}"#, #"{"type":"future","key":"my-tasks"}"#,
            #"{"type":"dashboard","key":4}"#, #""unexpected""#, "null",
            #"{"type":"dashboard","key":"my-tasks","html":"unapproved"}"#,
        ] {
            let message = try JSONDecoder()
                .decode(
                    Message.self,
                    from: Data(
                        """
                        {"id":"message","role":"assistant","text":"Still readable","ui":\(ui)}
                        """
                        .utf8))
            XCTAssertEqual(message.text, "Still readable")
            XCTAssertEqual(
                message.ui?.dashboardKey,
                ui == #"{"type":"dashboard","key":"my-tasks"}"# ? "my-tasks" : nil)
        }
        for key in [
            "../other", "UPPER", "under_score", "", "todo\n", String(repeating: "a", count: 65),
        ] {
            XCTAssertNil(MessageUI(type: "dashboard", key: key).dashboardKey)
        }
    }

    @MainActor func testRepeatedReferencesShareDraftAndPendingRetryBeyondRowLifetime() async throws
    {
        let snapshot = try fixture()
        var calls: [DashboardActionRequest] = []
        let store = ChatDashboardStore(transport: { _ in
            DashboardTransport(
                load: { snapshot }, present: { _ in throw APIError(message: "Unused") },
                action: { request in
                    calls.append(request)
                    if calls.count == 1 { throw APIError(message: "Response lost") }
                    return snapshot.widgets[0]
                })
        })
        store.show("todo", occurrence: "first")
        await store.refreshVisible()
        let first = store.model(for: "todo")
        first.trackerDrafts["todo/items"] = DashboardTrackerDraft(todo: "Water basil")
        let request = DashboardActionRequest(
            key: "todo", expectedRevision: 1, blockId: "items", action: .addTodo, id: "exact-id",
            label: "Water basil")
        _ = await first.trackerAction(request)
        store.hide("todo", occurrence: "first")
        store.show("todo", occurrence: "second")
        let second = store.model(for: "todo")
        XCTAssertTrue(first === second)
        XCTAssertEqual(second.trackerDrafts["todo/items"]?.todo, "Water basil")
        XCTAssertEqual(second.trackerRequests["todo/items"], request)
        _ = await second.trackerAction(
            DashboardActionRequest(
                key: "todo", expectedRevision: 1, blockId: "items", action: .addTodo, id: "new-id",
                label: "Different"))
        XCTAssertEqual(calls, [request, request])
        XCTAssertEqual(second.trackerDrafts["todo/items"]?.todo, "")
    }

    func testChatTransportRejectsAnotherWidgetAndAllowsUnavailableSnapshot() throws {
        XCTAssertNoThrow(try DashboardTransport.validateChat(fixture(), key: "todo"))
        XCTAssertThrowsError(try DashboardTransport.validateChat(fixture(), key: "foreign"))
        XCTAssertNoThrow(try DashboardTransport.validateChat(fixture(missing: true), key: "todo"))
        var duplicated = try fixture()
        duplicated.widgets += duplicated.widgets
        XCTAssertThrowsError(try DashboardTransport.validateChat(duplicated, key: "todo"))
    }

    @MainActor func testVisibleReferencesRefreshOncePerKeyAndHiddenCardsStopPolling() async throws {
        let snapshot = try fixture()
        var reads = 0
        var time = Date(timeIntervalSince1970: 0)
        let store = ChatDashboardStore(
            transport: { _ in
                DashboardTransport(
                    load: {
                        reads += 1
                        return snapshot
                    }, present: { _ in throw APIError(message: "Unused") })
            }, now: { time })
        store.show("todo", occurrence: "first")
        store.show("todo", occurrence: "second")
        await store.refreshVisible()
        await store.refresh("todo")
        XCTAssertEqual(reads, 1)
        time += 4
        store.hide("todo", occurrence: "first")
        await store.refreshVisible()
        XCTAssertEqual(reads, 2)
        store.hide("todo", occurrence: "second")
        time += 4
        await store.refreshVisible()
        XCTAssertEqual(reads, 2)
        await store.refresh("todo", force: true)
        XCTAssertEqual(reads, 3)
    }

    @MainActor func testConcurrentReferencesDeduplicateAndInvalidationRejectsLateLoadsAndActions()
        async throws
    {
        let snapshot = try fixture()
        let started = expectation(description: "Card loading")
        var resume: CheckedContinuation<DashboardSnapshot, Error>?
        var reads = 0
        var writes = 0
        let store = ChatDashboardStore(transport: { _ in
            DashboardTransport(
                load: {
                    reads += 1
                    return try await withCheckedThrowingContinuation {
                        resume = $0
                        started.fulfill()
                    }
                }, present: { _ in throw APIError(message: "Unused") },
                action: { _ in
                    writes += 1
                    return snapshot.widgets[0]
                })
        })
        let loading = Task { await store.refresh("todo") }
        await fulfillment(of: [started], timeout: 2)
        await store.refresh("todo", force: true)
        XCTAssertEqual(reads, 1)
        store.invalidate()
        resume?.resume(returning: snapshot)
        await loading.value
        let model = store.model(for: "todo")
        XCTAssertNil(model.snapshot)
        _ = await model.trackerAction(
            DashboardActionRequest(
                key: "todo", expectedRevision: 1, blockId: "items", action: .addTodo, id: "id",
                label: "No stale write"))
        await store.refresh("todo", force: true)
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(reads, 1)
    }

    @MainActor func testAppSharesAgentCardsAcrossReplyThreadsAndSeparatesAgents() throws {
        let app = AppModel()
        app.connection = Connection(server: URL(string: "https://example.com")!, token: "test")
        let moss = Agent(
            id: "moss", name: "Moss", instructions: "", character: "moss", model: "fixture",
            kind: nil)
        let wisp = Agent(
            id: "wisp", name: "Wisp", instructions: "", character: "wisp", model: "fixture",
            kind: nil)
        let main = try XCTUnwrap(app.conversation(agent: moss))
        let reply = try XCTUnwrap(app.conversation(agent: moss, id: "reply"))
        let other = try XCTUnwrap(app.conversation(agent: wisp))
        XCTAssertTrue(main.dashboards === reply.dashboards)
        XCTAssertFalse(main.dashboards === other.dashboards)
    }

    @MainActor func testChatSnapshotUsesScopedJuxiAndUnavailableReplacesPreviouslyLoadedData()
        async throws
    {
        let available = try fixture()
        let plan = try JuxiPlan(
            nodes: [
                JuxiNode(
                    id: "dashboard/view", component: "DashboardView",
                    props: [
                        "focus": .string("all"), "widgetKeys": .array([.string("todo")]),
                        "showDataSources": .bool(false),
                    ])
            ],
            decisions: [
                JuxiDecision(
                    slot: "dashboard", option: "widget-0-all", confidence: 1, reason: .selected)
            ])
        XCTAssertNoThrow(
            try DashboardJuxiBinding.prepare(plan: plan, snapshot: available, discuss: { _ in }))
        var calls = 0
        let missing = try fixture(missing: true)
        let store = ChatDashboardStore(transport: { _ in
            DashboardTransport(
                load: {
                    calls += 1
                    return calls == 1 ? available : missing
                }, present: { _ in throw APIError(message: "Unused") })
        })
        await store.refresh("todo")
        let model = store.model(for: "todo")
        XCTAssertEqual(model.snapshot?.widgets.count, 1)
        model.trackerDrafts["todo/items"] = DashboardTrackerDraft(todo: "Keep me")
        await store.refresh("todo", force: true)
        XCTAssertEqual(model.snapshot?.widgets.count, 0)
        XCTAssertEqual(model.snapshot?.presentation?.notice, "This tracker is no longer available.")
        XCTAssertEqual(model.trackerDrafts["todo/items"]?.todo, "Keep me")
    }

    private func fixture(missing: Bool = false) throws -> DashboardSnapshot {
        try JSONDecoder()
            .decode(
                DashboardSnapshot.self,
                from: Data(
                    """
                    {"enabled":true,"widgets":\(missing ? "[]" : #"[{"key":"todo","title":"To-do list","revision":1,"updatedAt":1,"blocks":[{"type":"todo-list","id":"items","items":[]}]}]"#),"datasets":[],"presentation":{"plan":null,"intent":"","focus":"all","widgetKey":"todo","revision":\(missing ? 0 : 4),"updatedAt":0,"canAdapt":false,"notice":\(missing ? #""This tracker is no longer available.""# : "null"),"availableFocus":["all"]}}
                    """
                    .utf8))
    }
}
