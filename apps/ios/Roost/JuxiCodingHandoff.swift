import JuxiSwiftUI
import SwiftUI

enum CodingHandoffView: String, Codable, CaseIterable, Identifiable {
    case overview, review
    case tryIt = "try"
    var id: String { rawValue }
    var title: String { self == .tryIt ? "Try it" : rawValue.capitalized }
}

struct CodingPresentation: Decodable {
    let defaultView: CodingHandoffView
    let availableViews: [CodingHandoffView]
    let plans: [String: JuxiPlan]
    private enum CodingKeys: String, CodingKey { case defaultView, availableViews, plans }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        defaultView =
            (try? values.decode(CodingHandoffView.self, forKey: .defaultView)) ?? .overview
        availableViews = ((try? values.decode([String].self, forKey: .availableViews)) ?? [])
            .compactMap(CodingHandoffView.init(rawValue:))
        plans = (try? values.decode([String: JuxiPlan].self, forKey: .plans)) ?? [:]
    }
}

struct CodingHandoffProps: Decodable {
    let jobId: String
    let view: CodingHandoffView
}

@MainActor enum CodingHandoffBinding {
    static func prepare<Content: View>(
        plan: JuxiPlan, jobId: String, view: CodingHandoffView,
        @ViewBuilder content: @escaping (CodingHandoffView) -> Content
    ) throws -> JuxiPreparedPlan {
        guard plan.nodes.count == 1, plan.decisions.count == 1,
            let node = plan.nodes.first, let decision = plan.decisions.first,
            node.id == "handoff/content", node.component == "CodingHandoff",
            Set(node.props.keys) == ["jobId", "view"],
            decision.slot == "handoff", decision.option == view.rawValue
        else { throw JuxiError.invalidPlan("Unsupported coding handoff.") }
        var registry = JuxiRegistry()
        let validate: (CodingHandoffProps) throws -> Void = { props in
            guard props.jobId == jobId, props.view == view else {
                throw JuxiError.invalidPlan("The handoff belongs to a different job or view.")
            }
        }
        try registry.register("CodingHandoff", props: CodingHandoffProps.self, validate: validate) {
            props in
            content(props.view)
        }
        return try registry.prepare(plan)
    }
}

@MainActor struct NativeCodingHandoff<Content: View>: View {
    let state: JuxiRenderState?
    let content: (CodingHandoffView) -> Content
    init(
        detail: CodingDetail, selection: CodingHandoffView,
        @ViewBuilder content: @escaping (CodingHandoffView) -> Content
    ) {
        self.content = content
        if let plan = detail.presentation?.plans[selection.rawValue] {
            do {
                state = .ready(
                    try CodingHandoffBinding.prepare(
                        plan: plan, jobId: detail.job.id,
                        view: selection, content: content))
            } catch { state = .failed(.invalidPlan("This handoff view is unavailable.")) }
        } else {
            state =
                detail.presentation == nil
                ? nil : .failed(.invalidPlan("This handoff view is unavailable."))
        }
    }
    var body: some View {
        if let state {
            JuxiPlanView(state: state) {
                content(.overview)
            } failure: { _ in
                Text("This view is unavailable. Showing the complete overview.").font(.caption)
                content(.overview)
            } empty: {
                content(.overview)
            }
        } else {
            content(.overview)
        }
    }
}
