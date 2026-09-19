import JuxiSwiftUI
import SwiftUI

struct DashboardPresentation: Decodable {
    let plan: JuxiPlan?
    let intent: String
    let focus: DashboardFocus?
    let widgetKey: String?
    let revision: Int
    let updatedAt: Double
    let canAdapt: Bool
    let notice: String?
    let availableFocus: [DashboardFocus]
    let hasInvalidPlan: Bool

    private enum CodingKeys: String, CodingKey {
        case plan, intent, focus, widgetKey, revision, updatedAt, canAdapt, notice, availableFocus
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        // A future or malformed plan must never hide the ordinary dashboard data.
        plan = try? values.decode(JuxiPlan.self, forKey: .plan)
        hasInvalidPlan =
            values.contains(.plan)
            && (try? values.decodeNil(forKey: .plan)) == false && plan == nil
        intent = try values.decode(String.self, forKey: .intent)
        focus = try? values.decode(DashboardFocus.self, forKey: .focus)
        widgetKey = try values.decodeIfPresent(String.self, forKey: .widgetKey)
        revision = try values.decode(Int.self, forKey: .revision)
        updatedAt = try values.decode(Double.self, forKey: .updatedAt)
        canAdapt = try values.decode(Bool.self, forKey: .canAdapt)
        notice = try values.decodeIfPresent(String.self, forKey: .notice)
        availableFocus = try values.decode([String].self, forKey: .availableFocus)
            .compactMap(DashboardFocus.init(rawValue:))
    }
}

struct JuxiDashboardProps: Decodable {
    let focus: DashboardFocus
    let widgetKeys: [String]
    let showDataSources: Bool
}

/// Roost's binding is deliberately narrow: Juxi selects an authored view of current data.
@MainActor enum DashboardJuxiBinding {
    static func prepare(
        plan: JuxiPlan, snapshot: DashboardSnapshot, discuss: @escaping (String) -> Void
    ) throws -> JuxiPreparedPlan {
        guard plan.nodes.count == 1, plan.decisions.count == 1,
            let node = plan.nodes.first, let decision = plan.decisions.first,
            node.id == "dashboard/view", node.component == "DashboardView",
            decision.slot == "dashboard",
            case .string(let rawFocus)? = node.props["focus"],
            let focus = DashboardFocus(rawValue: rawFocus),
            Set(node.props.keys) == ["focus", "widgetKeys", "showDataSources"]
        else { throw JuxiError.invalidPlan("Unsupported dashboard view.") }
        let expectedKeys: [String]
        let showsSources: Bool
        let expectedOption: String
        if let key = snapshot.presentation?.widgetKey {
            guard let index = snapshot.widgets.map(\.key).sorted().firstIndex(of: key),
                let widget = snapshot.widgets.first(where: { $0.key == key }),
                widget.blocks.contains(where: focus.includes)
            else { throw JuxiError.invalidPlan("The focused widget is no longer available.") }
            expectedKeys = [key]
            showsSources = false
            expectedOption = "widget-\(index)-\(focus.rawValue)"
        } else {
            expectedKeys = snapshot.widgets
                .filter {
                    $0.blocks.contains(where: focus.includes)
                }
                .map(\.key)
            showsSources = focus == .all || focus == .tables
            expectedOption = focus.rawValue
        }
        guard decision.option == expectedOption else {
            throw JuxiError.invalidPlan("The view does not match its dashboard selection.")
        }
        var registry = JuxiRegistry()
        let validate: (JuxiDashboardProps) throws -> Void = { props in
            guard props.focus == focus, props.widgetKeys == expectedKeys,
                props.showDataSources == showsSources,
                !expectedKeys.isEmpty || (showsSources && !snapshot.datasets.isEmpty)
            else { throw JuxiError.invalidPlan("The view does not match current dashboard data.") }
        }
        try registry.register("DashboardView", props: JuxiDashboardProps.self, validate: validate) {
            props in
            DashboardNativeContent(snapshot: snapshot, props: props, discuss: discuss)
        }
        return try registry.prepare(plan)
    }
}

@MainActor struct JuxiDashboardContent: View {
    @Environment(\.palette) private var palette
    let snapshot: DashboardSnapshot
    let discuss: (String) -> Void
    private let state: JuxiRenderState?

    init(snapshot: DashboardSnapshot, discuss: @escaping (String) -> Void) {
        self.snapshot = snapshot
        self.discuss = discuss
        if let plan = snapshot.presentation?.plan {
            do {
                state = .ready(
                    try DashboardJuxiBinding.prepare(
                        plan: plan, snapshot: snapshot, discuss: discuss))
            } catch {
                state = .failed(.invalidPlan("The dashboard view is unavailable."))
            }
        } else if snapshot.presentation?.hasInvalidPlan == true {
            state = .failed(.invalidPlan("The dashboard view is unavailable."))
        } else {
            state = nil
        }
    }

    var body: some View {
        if let state {
            JuxiPlanView(state: state) {
                standardContent
            } failure: { _ in
                Label("This view is unavailable. Showing everything.", systemImage: "info.circle")
                    .font(.caption).foregroundStyle(palette.muted)
                standardContent
            } empty: {
                standardContent
            }
        } else {
            standardContent
        }
    }

    private var standardContent: some View {
        DashboardNativeContent(
            snapshot: snapshot,
            props: JuxiDashboardProps(
                focus: .all, widgetKeys: snapshot.widgets.map(\.key), showDataSources: true),
            discuss: discuss)
    }
}

struct DashboardNativeContent: View {
    let snapshot: DashboardSnapshot
    let props: JuxiDashboardProps
    let discuss: (String) -> Void

    var body: some View {
        ForEach(snapshot.widgets.filter { props.widgetKeys.contains($0.key) }) { widget in
            let blocks = widget.blocks.filter(props.focus.includes)
            if !blocks.isEmpty {
                DashboardWidgetCard(
                    widget: widget, blocks: blocks, datasets: snapshot.datasets, discuss: discuss)
            }
        }
        if props.showDataSources { DashboardDataSources(datasets: snapshot.datasets) }
    }
}
