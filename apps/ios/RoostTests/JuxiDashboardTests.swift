import JuxiSwiftUI
import XCTest

@testable import Roost

final class JuxiDashboardTests: XCTestCase {
    func testOlderServerDashboardStillDecodes() throws {
        let snapshot = try JSONDecoder()
            .decode(
                DashboardSnapshot.self,
                from: Data(#"{"enabled":true,"widgets":[],"datasets":[]}"#.utf8))
        XCTAssertNil(snapshot.presentation)
    }

    func testFocusRetainsOnlyAuthoredBlockTypes() throws {
        let snapshot = try fixture()
        let blocks = try XCTUnwrap(snapshot.widgets.first?.blocks)
        XCTAssertEqual(
            blocks.filter(DashboardFocus.summary.includes).map(\.type), ["metrics", "markdown"])
        XCTAssertEqual(
            blocks.filter(DashboardFocus.charts.includes).map(\.type), ["chart", "dataset-chart"])
        XCTAssertEqual(blocks.filter(DashboardFocus.tables.includes).map(\.type), ["table"])
        XCTAssertEqual(blocks.filter(DashboardFocus.tasks.includes).map(\.type), ["tasks"])
        XCTAssertEqual(blocks.filter(DashboardFocus.all.includes).count, blocks.count)
    }

    @MainActor func testDelayedPollCannotReplaceConfirmedPresentation() async throws {
        let baseline = try fixture(revision: 1)
        let changed = try XCTUnwrap(fixture(revision: 2, focus: "charts").presentation)
        var reads = 0
        var resume: CheckedContinuation<DashboardSnapshot, Error>?
        let started = expectation(description: "Delayed refresh started")
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: {
                    reads += 1
                    if reads == 1 { return baseline }
                    return try await withCheckedThrowingContinuation { continuation in
                        resume = continuation
                        started.fulfill()
                    }
                },
                present: { request in
                    XCTAssertEqual(request.revision, 1)
                    XCTAssertEqual(request.focus, .charts)
                    XCTAssertNil(request.intent)
                    return changed
                }))
        await model.refresh()
        let delayed = Task { await model.refresh() }
        await fulfillment(of: [started], timeout: 2)
        await model.select(.charts)
        resume?.resume(returning: baseline)
        await delayed.value
        XCTAssertEqual(model.snapshot?.presentation?.revision, 2)
        XCTAssertEqual(model.snapshot?.presentation?.focus, .charts)
        XCTAssertFalse(model.updating)
    }

    @MainActor func testFailurePreservesLoadedContentAndDescription() async throws {
        let baseline = try fixture()
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: { baseline },
                present: { _ in throw APIError(message: "The connection is offline.") }))
        await model.refresh()
        model.intentDraft = "Show my progress"
        await model.adapt()
        XCTAssertEqual(model.snapshot?.widgets.map(\.key), ["garden"])
        XCTAssertEqual(model.intentDraft, "Show my progress")
        XCTAssertEqual(model.error, "The connection is offline.")
        XCTAssertFalse(model.updating)
    }

    @MainActor func testConflictReloadsLatestWithoutRetryingOrErasingDraft() async throws {
        let baseline = try fixture(revision: 1)
        let latest = try fixture(revision: 3, focus: "tasks")
        var reads = 0
        var writes = 0
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: {
                    reads += 1
                    return reads == 1 ? baseline : latest
                },
                present: { _ in
                    writes += 1
                    throw APIError(message: "Dashboard view changed", status: 409)
                }))
        await model.refresh()
        model.intentDraft = "Show my progress"
        await model.adapt()
        XCTAssertEqual(writes, 1)
        XCTAssertEqual(reads, 2)
        XCTAssertEqual(model.snapshot?.presentation?.focus, .tasks)
        XCTAssertEqual(model.snapshot?.presentation?.revision, 3)
        XCTAssertEqual(model.intentDraft, "Show my progress")
        XCTAssertTrue(model.error?.contains("try your change again") == true)
    }

    @MainActor func testPollingNeverOverwritesUnsubmittedDescription() async throws {
        let baseline = try fixture()
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: { baseline }, present: { _ in try XCTUnwrap(baseline.presentation) }))
        await model.refresh()
        model.intentDraft = "An unfinished thought"
        await model.refresh()
        XCTAssertEqual(model.intentDraft, "An unfinished thought")
    }

    @MainActor func testPendingAdaptationPreservesDescriptionEditedWhileWaiting() async throws {
        let baseline = try fixture()
        let result = try XCTUnwrap(fixture(revision: 2, focus: "summary").presentation)
        var resume: CheckedContinuation<DashboardPresentation, Error>?
        let started = expectation(description: "Adaptation started")
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: { baseline },
                present: { _ in
                    try await withCheckedThrowingContinuation { continuation in
                        resume = continuation
                        started.fulfill()
                    }
                }))
        await model.refresh()
        model.intentDraft = "Show progress"
        let update = Task { await model.adapt() }
        await fulfillment(of: [started], timeout: 2)
        model.intentDraft = "Show progress and tasks"
        resume?.resume(returning: result)
        await update.value
        XCTAssertEqual(model.intentDraft, "Show progress and tasks")
        XCTAssertEqual(model.snapshot?.presentation?.revision, 2)
    }

    @MainActor func testBindsServerPlanToNativeDashboardComponent() throws {
        let snapshot = try fixture()
        let plan = try plan(focus: .charts)
        let prepared = try DashboardJuxiBinding.prepare(
            plan: plan, snapshot: snapshot,
            discuss: { _ in XCTFail("Rendering must not send messages") })
        XCTAssertEqual(prepared.nodeIDs, ["dashboard/view"])
        XCTAssertEqual(JuxiRenderState.ready(prepared).phase, .content)
    }

    @MainActor func testRejectsUnknownComponentsAndStaleOrFabricatedReferences() throws {
        let snapshot = try fixture()
        for invalid in [
            try plan(focus: .charts, component: "ArbitraryView"),
            try plan(focus: .charts, keys: ["missing"]),
            try plan(focus: .charts, keys: ["garden", "garden"]),
            try plan(focus: .charts, keys: []),
            try plan(focus: .charts, showDataSources: true),
            try plan(focus: .charts, option: "tasks"),
        ] {
            XCTAssertThrowsError(
                try DashboardJuxiBinding.prepare(
                    plan: invalid, snapshot: snapshot, discuss: { _ in }))
        }
    }

    @MainActor func testScopedPlanUsesCurrentSortedInventoryAndKeepsDataSourcesHidden() throws {
        let data = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(plan(focus: .charts)))
        var source = try XCTUnwrap(data as? [String: Any])
        source["decisions"] = [
            [
                "slot": "dashboard", "option": "widget-1-charts", "confidence": 1,
                "reason": "selected",
            ]
        ]
        // The full inventory is deliberately not sorted, and includes a widget with no chart.
        let snapshot = try fixture(widgetKey: "garden", extraWidgetKey: "alpha")
        let scoped = try JuxiPlan.decode(from: JSONSerialization.data(withJSONObject: source))
        let prepared = try DashboardJuxiBinding.prepare(
            plan: scoped, snapshot: snapshot, discuss: { _ in })
        XCTAssertEqual(prepared.nodeIDs, ["dashboard/view"])
        XCTAssertThrowsError(
            try DashboardJuxiBinding.prepare(
                plan: plan(focus: .charts, showDataSources: true, option: "widget-1-charts"),
                snapshot: snapshot, discuss: { _ in }))
        XCTAssertThrowsError(
            try DashboardJuxiBinding.prepare(
                plan: plan(focus: .charts, option: "widget-0-charts"),
                snapshot: snapshot, discuss: { _ in }),
            "Option index must match the current full sorted inventory")
    }

    @MainActor func testScopedPlanRejectsMissingScopeAndUnrelatedWidget() throws {
        let scoped = try plan(focus: .charts, option: "widget-0-charts")
        XCTAssertThrowsError(
            try DashboardJuxiBinding.prepare(
                plan: scoped, snapshot: fixture(), discuss: { _ in }))
        XCTAssertThrowsError(
            try DashboardJuxiBinding.prepare(
                plan: scoped, snapshot: fixture(widgetKey: "removed"), discuss: { _ in }))
        XCTAssertThrowsError(
            try DashboardJuxiBinding.prepare(
                plan: plan(focus: .charts, keys: ["unrelated"], option: "widget-0-charts"),
                snapshot: fixture(widgetKey: "garden"), discuss: { _ in }))
        XCTAssertThrowsError(
            try DashboardJuxiBinding.prepare(
                plan: plan(focus: .charts, keys: ["alpha"], option: "widget-0-charts"),
                snapshot: fixture(widgetKey: "alpha", extraWidgetKey: "alpha"), discuss: { _ in }),
            "A scoped widget must contain the chosen type of content")
    }

    @MainActor func testSelectingGlobalFocusClearsWidgetScope() async throws {
        let scoped = try fixture(widgetKey: "garden")
        let global = try XCTUnwrap(fixture(revision: 2, focus: "charts").presentation)
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: { scoped },
                present: { request in
                    XCTAssertEqual(request.focus, .charts)
                    XCTAssertNil(request.intent)
                    return global
                }))
        await model.refresh()
        XCTAssertEqual(model.snapshot?.presentation?.widgetKey, "garden")
        await model.select(.charts)
        XCTAssertNil(model.snapshot?.presentation?.widgetKey)
    }

    func testFuturePlanFallsBackWithoutLosingDashboardData() throws {
        let snapshot = try fixture(plan: ["version": 2, "nodes": [], "decisions": []])
        XCTAssertNil(snapshot.presentation?.plan)
        XCTAssertEqual(snapshot.presentation?.hasInvalidPlan, true)
        XCTAssertEqual(snapshot.widgets.map(\.key), ["garden"])
    }

    @MainActor func testConflictWithFailedReloadDoesNotClaimLatestContentLoaded() async throws {
        let baseline = try fixture()
        var reads = 0
        let model = JuxiDashboardModel(
            transport: DashboardTransport(
                load: {
                    reads += 1
                    if reads == 1 { return baseline }
                    throw APIError(message: "Offline")
                }, present: { _ in throw APIError(message: "Conflict", status: 409) }))
        await model.refresh()
        model.intentDraft = "Show next steps"
        await model.adapt()
        XCTAssertEqual(model.snapshot?.widgets.map(\.key), ["garden"])
        XCTAssertEqual(model.intentDraft, "Show next steps")
        XCTAssertTrue(model.error?.contains("Pull to refresh") == true)
    }

    private func plan(
        focus: DashboardFocus, component: String = "DashboardView",
        keys: [String] = ["garden"], showDataSources: Bool = false,
        option: String? = nil
    ) throws -> JuxiPlan {
        try JuxiPlan(
            nodes: [
                JuxiNode(
                    id: "dashboard/view", component: component,
                    props: [
                        "focus": .string(focus.rawValue),
                        "widgetKeys": .array(keys.map(JSONValue.string)),
                        "showDataSources": .bool(showDataSources),
                    ])
            ],
            decisions: [
                JuxiDecision(
                    slot: "dashboard", option: option ?? focus.rawValue,
                    confidence: 1, reason: .selected)
            ])
    }

    private func fixture(
        revision: Int = 1, focus: String? = nil, plan: [String: Any]? = nil,
        widgetKey: String? = nil, extraWidgetKey: String? = nil
    ) throws -> DashboardSnapshot {
        var source: [String: Any] = [
            "enabled": true,
            "widgets": [
                [
                    "key": "garden", "title": "Garden", "updatedAt": 1,
                    "blocks": [
                        "metrics", "markdown", "chart", "dataset-chart", "table", "tasks", "links",
                    ]
                    .map { ["type": $0] },
                ]
            ],
            "datasets": [],
            "presentation": [
                "plan": plan as Any? ?? NSNull(), "intent": "", "focus": focus as Any? ?? NSNull(),
                "revision": revision, "updatedAt": 1, "canAdapt": true,
                "widgetKey": widgetKey as Any? ?? NSNull(),
                "notice": NSNull(),
                "availableFocus": ["all", "summary", "charts", "tables", "tasks"],
            ],
        ]
        if let extraWidgetKey {
            var widgets = try XCTUnwrap(source["widgets"] as? [[String: Any]])
            widgets.append([
                "key": extraWidgetKey, "title": "Other", "updatedAt": 0,
                "blocks": [["type": "markdown", "text": "Other content"]],
            ])
            source["widgets"] = widgets
        }
        return try JSONDecoder()
            .decode(
                DashboardSnapshot.self, from: JSONSerialization.data(withJSONObject: source))
    }
}
