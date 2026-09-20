import SwiftUI

/// The application owns fetching, cancellation, caching, and state transitions.
@MainActor
public enum JuxiRenderState {
    case idle
    case loading
    case ready(JuxiPreparedPlan)
    case failed(JuxiError)

    public enum Phase: Equatable, Sendable { case idle, loading, content, empty, failure }

    public var phase: Phase {
        switch self {
        case .idle: return .idle
        case .loading: return .loading
        case .ready(let prepared): return prepared.isEmpty ? .empty : .content
        case .failed: return .failure
        }
    }
}

/// Native SwiftUI only. Put this view in your own VStack, List, or other layout.
@MainActor
public struct JuxiPlanView: View {
    private let state: JuxiRenderState
    private let loading: () -> AnyView
    private let failure: (JuxiError) -> AnyView
    private let empty: () -> AnyView

    /// Empty plans and idle state render nothing. Invalid plans show a generic error.
    public init(state: JuxiRenderState) {
        self.state = state
        loading = { AnyView(ProgressView("Loading interface…")) }
        failure = { _ in AnyView(Text("This interface is unavailable.")) }
        empty = { AnyView(EmptyView()) }
    }

    public init<Loading: View, Failure: View, Empty: View>(
        state: JuxiRenderState,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping (JuxiError) -> Failure,
        @ViewBuilder empty: @escaping () -> Empty
    ) {
        self.state = state
        self.loading = { AnyView(loading()) }
        self.failure = { AnyView(failure($0)) }
        self.empty = { AnyView(empty()) }
    }

    public var body: some View {
        switch state {
        case .idle:
            EmptyView()
        case .loading:
            loading()
        case .failed(let error):
            failure(error)
        case .ready(let prepared):
            if prepared.isEmpty {
                empty()
            } else {
                ForEach(prepared.nodes) { node in
                    node.build()
                }
            }
        }
    }
}
