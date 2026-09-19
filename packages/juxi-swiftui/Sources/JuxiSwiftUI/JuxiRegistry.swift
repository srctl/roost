import Foundation
import SwiftUI

/// Application-owned bindings. Registration and native view creation stay on the main actor.
@MainActor
public struct JuxiRegistry {
    private typealias PrepareNode = (JuxiNode) throws -> PreparedNode
    private var components: [String: PrepareNode] = [:]

    public init() {}

    /// Decode typed props, optionally enforce app-specific rules, then build a native View.
    /// No builder runs until every node in the plan has passed validation.
    public mutating func register<Props: Decodable, Content: View>(
        _ name: String,
        props: Props.Type,
        validate: @escaping (Props) throws -> Void = { _ in },
        @ViewBuilder content: @escaping (Props) -> Content
    ) throws {
        guard PlanValidation.isIdentifier(name) else {
            throw JuxiError.invalidComponentName(name)
        }
        guard components[name] == nil else {
            throw JuxiError.duplicateRegistration(name)
        }

        components[name] = { node in
            do {
                let data = try JSONEncoder().encode(node.props)
                let decoded = try JSONDecoder().decode(Props.self, from: data)
                try validate(decoded)
                return PreparedNode(id: node.id, build: { AnyView(content(decoded)) })
            } catch {
                // Do not expose raw props or decoder messages in UI error output.
                throw JuxiError.invalidProps(component: name, nodeID: node.id)
            }
        }
    }

    /// Prepare once when data arrives, rather than decoding props on every SwiftUI render.
    public func prepare(_ plan: JuxiPlan) throws -> JuxiPreparedPlan {
        var nodes: [PreparedNode] = []
        for node in plan.nodes {
            guard let prepareNode = components[node.component] else {
                throw JuxiError.unknownComponent(node.component)
            }
            nodes.append(try prepareNode(node))
        }
        return JuxiPreparedPlan(plan: plan, nodes: nodes)
    }

    /// Convenience for application-owned network completion handlers. Never performs I/O.
    public func resolve(_ data: Data, maximumBytes: Int = 1_048_576) -> JuxiRenderState {
        do {
            let plan = try JuxiPlan.decode(from: data, maximumBytes: maximumBytes)
            return .ready(try prepare(plan))
        } catch let error as JuxiError {
            return .failed(error)
        } catch {
            return .failed(.invalidPlan("Unable to prepare the interface."))
        }
    }
}

@MainActor
struct PreparedNode: Identifiable {
    let id: String
    let build: () -> AnyView
}

/// Immutable validated snapshot. It contains native builders, so it is not wire data.
@MainActor
public struct JuxiPreparedPlan {
    public let plan: JuxiPlan
    let nodes: [PreparedNode]

    public var isEmpty: Bool { nodes.isEmpty }
    public var nodeIDs: [String] { nodes.map(\.id) }
}
