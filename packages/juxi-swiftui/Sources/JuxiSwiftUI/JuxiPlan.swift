import Foundation

/// The same version-1 JSON payload returned by Juxi's JavaScript planner.
public struct JuxiPlan: Codable, Equatable, Sendable {
    public let version: Int
    public let nodes: [JuxiNode]
    public let decisions: [JuxiDecision]

    public init(version: Int = 1, nodes: [JuxiNode], decisions: [JuxiDecision]) throws {
        guard version == 1 else { throw JuxiError.unsupportedVersion(version) }
        guard nodes.count <= 2048 else {
            throw JuxiError.invalidPlan("A plan may contain at most 2048 nodes.")
        }
        guard decisions.count <= 32 else {
            throw JuxiError.invalidPlan("A plan may contain at most 32 decisions.")
        }
        guard Set(nodes.map(\.id)).count == nodes.count else {
            throw JuxiError.invalidPlan("Node ids must be unique.")
        }
        self.version = version
        self.nodes = nodes
        self.decisions = decisions
    }

    private enum CodingKeys: String, CodingKey { case version, nodes, decisions }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        // Report unsupported versions before trying to interpret their payload shape.
        guard version == 1 else { throw JuxiError.unsupportedVersion(version) }
        try self.init(
            version: version,
            nodes: container.decode([JuxiNode].self, forKey: .nodes),
            decisions: container.decode([JuxiDecision].self, forKey: .decisions)
        )
    }

    /// A defensive byte limit supplements the wire schema's node and decision limits.
    public static func decode(from data: Data, maximumBytes: Int = 1_048_576) throws -> JuxiPlan {
        guard maximumBytes > 0, data.count <= maximumBytes else {
            throw JuxiError.payloadTooLarge(maximumBytes: maximumBytes)
        }
        do {
            return try JSONDecoder().decode(JuxiPlan.self, from: data)
        } catch let error as JuxiError {
            throw error
        } catch {
            throw JuxiError.invalidPlan("Malformed JSON or missing/incorrect fields.")
        }
    }
}

public struct JuxiNode: Codable, Equatable, Sendable {
    public let id: String
    public let component: String
    public let props: [String: JSONValue]

    public init(id: String, component: String, props: [String: JSONValue]) throws {
        // JavaScript string lengths count UTF-16 code units.
        guard (1...256).contains(id.utf16.count) else {
            throw JuxiError.invalidPlan("Node ids must contain 1–256 UTF-16 code units.")
        }
        guard PlanValidation.isIdentifier(component) else {
            throw JuxiError.invalidComponentName(component)
        }
        // Also reject nonfinite numbers in locally constructed JSON values.
        _ = try JSONEncoder().encode(props)
        self.id = id
        self.component = component
        self.props = props
    }

    private enum CodingKeys: String, CodingKey { case id, component, props }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            id: container.decode(String.self, forKey: .id),
            component: container.decode(String.self, forKey: .component),
            props: container.decode([String: JSONValue].self, forKey: .props)
        )
    }
}

public struct JuxiDecision: Codable, Equatable, Sendable {
    public enum Reason: String, Codable, Sendable {
        case selected
        case lowConfidence = "low-confidence"
        case invalidAnswer = "invalid-answer"
    }

    public let slot: String
    public let option: String
    public let confidence: Double?
    public let reason: Reason

    public init(slot: String, option: String, confidence: Double?, reason: Reason) throws {
        guard PlanValidation.isIdentifier(slot), PlanValidation.isIdentifier(option) else {
            throw JuxiError.invalidPlan("Decision slot and option must be valid identifiers.")
        }
        if let confidence {
            guard confidence.isFinite, (0...1).contains(confidence) else {
                throw JuxiError.invalidPlan("Confidence must be null or a finite number from 0 to 1.")
            }
        }
        self.slot = slot
        self.option = option
        self.confidence = confidence
        self.reason = reason
    }

    private enum CodingKeys: String, CodingKey { case slot, option, confidence, reason }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        try self.init(
            slot: container.decode(String.self, forKey: .slot),
            option: container.decode(String.self, forKey: .option),
            // Required key, nullable value: decodeIfPresent would also allow a missing key.
            confidence: container.decode(Double?.self, forKey: .confidence),
            reason: container.decode(Reason.self, forKey: .reason)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(slot, forKey: .slot)
        try container.encode(option, forKey: .option)
        // Preserve an explicit JSON null, as required by the JS schema.
        try container.encode(confidence, forKey: .confidence)
        try container.encode(reason, forKey: .reason)
    }
}
