import XCTest

@testable import Roost

final class DashboardTrackerTests: XCTestCase {
    func testCalorieTotalsUseSelectedCivilDayAndExplicitIntegerValues() throws {
        let entries = try JSONDecoder()
            .decode(
                [DashboardMeal].self,
                from: Data(
                    #"[{"id":"a","date":"2026-09-19","label":"Lunch","calories":500},{"id":"b","date":"2026-09-20","label":"Breakfast","calories":300},{"id":"c","date":"2026-09-19","label":"Snack","calories":150}]"#
                        .utf8))
        XCTAssertEqual(DashboardTrackerValues.total(entries, day: "2026-09-19"), 650)
        XCTAssertEqual(DashboardTrackerValues.total(entries, day: "2026-09-18"), 0)
        let date = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-20T01:30:00Z"))
        XCTAssertEqual(
            DashboardTrackerValues.day(
                date, timeZone: try XCTUnwrap(TimeZone(identifier: "America/Los_Angeles"))),
            "2026-09-19")
        XCTAssertEqual(DashboardTrackerValues.calories(" 450 "), 450)
        XCTAssertEqual(DashboardTrackerValues.calories("0"), 0)
        for invalid in ["", "-1", "450.5", "estimated 500", "20001", "１２３", "500 kcal"] {
            XCTAssertNil(DashboardTrackerValues.calories(invalid), invalid)
        }
    }

    func testNewBlockTypesParticipateInExpectedViews() throws {
        let snapshot = try snapshot()
        let todo = try XCTUnwrap(snapshot.widgets.first?.blocks.first)
        XCTAssertTrue(DashboardFocus.tasks.includes(todo))
        XCTAssertFalse(DashboardFocus.tables.includes(todo))
        let meal = try JSONDecoder()
            .decode(
                DashboardBlock.self,
                from: Data(#"{"type":"calorie-log","id":"food","entries":[]}"#.utf8))
        XCTAssertTrue(DashboardFocus.tables.includes(meal))
        XCTAssertFalse(DashboardFocus.tasks.includes(meal))
        XCTAssertEqual(snapshot.widgets.first?.revision, 1)
    }

    @MainActor func testAmbiguousAddRetriesExactIdentityAndPayloadWithoutLosingDraft() async throws
    {
        let baseline = try snapshot()
        let updated = try snapshot(
            revision: 2, items: #"[{"id":"saved-id","label":"Buy basil","done":false}]"#
        )
        .widgets[0]
        var requests: [DashboardActionRequest] = []
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: { baseline }, present: { _ in throw APIError(message: "Unused") },
                action: { input in
                    requests.append(input)
                    if requests.count == 1 {
                        throw APIError(message: "Connection interrupted", status: 503)
                    }
                    return updated
                }))
        await model.refresh()
        model.trackerDrafts["garden/items"] = DashboardTrackerDraft(todo: "Buy basil")
        let original = request(id: "saved-id", label: "Buy basil")
        let first = await model.trackerAction(original)
        XCTAssertFalse(first)
        XCTAssertEqual(model.trackerDrafts["garden/items"]?.todo, "Buy basil")
        XCTAssertEqual(model.trackerRequests["garden/items"], original)
        let retried = await model.trackerAction(request(id: "different", label: "Different text"))
        XCTAssertTrue(retried)
        XCTAssertEqual(requests, [original, original])
        XCTAssertNil(model.trackerRequests["garden/items"])
        XCTAssertEqual(model.snapshot?.widgets.first?.revision, 2)
        XCTAssertEqual(model.trackerDrafts["garden/items"]?.todo, "")
    }

    @MainActor func testConflictReloadsNewEntriesAndRetainsDraftWithoutRetrying() async throws {
        let baseline = try snapshot()
        let newer = try snapshot(
            revision: 4, items: #"[{"id":"other","label":"Existing task","done":true}]"#)
        var reads = 0
        var writes = 0
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: {
                    reads += 1
                    return reads == 1 ? baseline : newer
                },
                present: { _ in throw APIError(message: "Unused") },
                action: { _ in
                    writes += 1
                    throw APIError(message: "Conflict", status: 409)
                }))
        await model.refresh()
        model.trackerDrafts["garden/items"] = DashboardTrackerDraft(todo: "Keep this task")
        let saved = await model.trackerAction(request(id: "new", label: "Keep this task"))
        XCTAssertFalse(saved)
        XCTAssertEqual(writes, 1)
        XCTAssertEqual(model.snapshot?.widgets.first?.revision, 4)
        XCTAssertEqual(model.trackerDrafts["garden/items"]?.todo, "Keep this task")
        XCTAssertNil(model.trackerRequests["garden/items"])
        XCTAssertTrue(model.trackerErrors["garden/items"]?.contains("review the latest") == true)
    }

    @MainActor func testOldPollCannotRollBackSavedTracker() async throws {
        let baseline = try snapshot()
        let updated = try snapshot(revision: 2).widgets[0]
        let started = expectation(description: "Refresh pending")
        var resume: CheckedContinuation<DashboardSnapshot, Error>?
        var reads = 0
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: {
                    reads += 1
                    if reads == 1 { return baseline }
                    return try await withCheckedThrowingContinuation {
                        resume = $0
                        started.fulfill()
                    }
                }, present: { _ in throw APIError(message: "Unused") }, action: { _ in updated }))
        await model.refresh()
        let delayed = Task { await model.refresh() }
        await fulfillment(of: [started], timeout: 2)
        _ = await model.trackerAction(request(id: "new", label: "Buy basil"))
        resume?.resume(returning: baseline)
        await delayed.value
        XCTAssertEqual(model.snapshot?.widgets.first?.revision, 2)
    }

    @MainActor func testCreatedTrackerIsNotRetriedWhenResetViewConflicts() async throws {
        let source = try snapshot()
        var initial = source
        let presentation = try JSONDecoder()
            .decode(
                DashboardPresentation.self,
                from: Data(
                    #"{"plan":null,"intent":"Charts","focus":"charts","widgetKey":null,"revision":1,"updatedAt":1,"canAdapt":false,"notice":null,"availableFocus":["all","charts","tasks"]}"#
                        .utf8))
        initial.presentation = presentation
        let loaded = initial
        var creates = 0
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: { loaded },
                present: { _ in throw APIError(message: "Conflict", status: 409) },
                create: { _ in
                    creates += 1
                    return source.widgets[0]
                }))
        await model.refresh()
        let created = await model.createTracker(
            DashboardTrackerRequest(key: "garden", kind: .todo, title: "Tasks"))
        XCTAssertTrue(
            created, "The tracker was created even when the other device changed the selected view")
        XCTAssertEqual(creates, 1)
        XCTAssertEqual(model.error, "Tracker created. Reset the dashboard view to see it.")
        XCTAssertFalse(model.updating)
    }

    @MainActor func testUnresolvedCreationRetainsIdentityWhenSheetIsReopened() async throws {
        let baseline = try snapshot()
        var sent: [DashboardTrackerRequest] = []
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: { baseline }, present: { _ in throw APIError(message: "Unused") },
                create: { input in
                    sent.append(input)
                    if sent.count == 1 { throw APIError(message: "Response lost", status: 503) }
                    return baseline.widgets[0]
                }))
        await model.refresh()
        let first = DashboardTrackerRequest(key: "stable-key", kind: .todo, title: "Tasks")
        let initial = await model.createTracker(first)
        XCTAssertFalse(initial)
        XCTAssertEqual(model.pendingTrackerCreation, first)
        let second = await model.createTracker(
            DashboardTrackerRequest(key: "new-key", kind: .calories, title: "Different form"))
        XCTAssertTrue(second)
        XCTAssertEqual(
            sent, [first, first],
            "Reopening must resume the unresolved creation, not create a duplicate")
        XCTAssertNil(model.pendingTrackerCreation)
    }

    private func request(id: String, label: String) -> DashboardActionRequest {
        DashboardActionRequest(
            key: "garden", expectedRevision: 1, blockId: "items", action: .addTodo,
            id: id, label: label)
    }
    private func snapshot(revision: Int = 1, items: String = "[]") throws -> DashboardSnapshot {
        try JSONDecoder()
            .decode(
                DashboardSnapshot.self,
                from: Data(
                    """
                    {"enabled":true,"widgets":[{"key":"garden","title":"Tasks","revision":\(revision),"updatedAt":1,"blocks":[{"type":"todo-list","id":"items","items":\(items)}]}],"datasets":[],"presentation":null}
                    """
                    .utf8))
    }
}
