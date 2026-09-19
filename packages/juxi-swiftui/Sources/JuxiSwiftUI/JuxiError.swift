import Foundation

/// Stable failure categories. Messages never include the contents of component props.
public enum JuxiError: Error, Equatable, LocalizedError, Sendable {
    case invalidPlan(String)
    case unsupportedVersion(Int)
    case payloadTooLarge(maximumBytes: Int)
    case invalidComponentName(String)
    case duplicateRegistration(String)
    case unknownComponent(String)
    case invalidProps(component: String, nodeID: String)

    public var errorDescription: String? {
        switch self {
        case .invalidPlan(let reason):
            return "Invalid Juxi plan: \(reason)"
        case .unsupportedVersion(let version):
            return "Unsupported Juxi plan version: \(version)"
        case .payloadTooLarge(let maximumBytes):
            return "Juxi plan exceeds the \(maximumBytes)-byte limit."
        case .invalidComponentName(let name):
            return "Invalid Juxi component name: \(name)"
        case .duplicateRegistration(let name):
            return "Juxi component is already registered: \(name)"
        case .unknownComponent(let name):
            return "Unknown Juxi component: \(name)"
        case .invalidProps(let component, let nodeID):
            return "Invalid props for Juxi component \(component) at node \(nodeID)."
        }
    }
}

// Match the ASCII identifiers used by the JavaScript version-1 schema.
enum PlanValidation {
    static func isIdentifier(_ value: String) -> Bool {
        let scalars = Array(value.unicodeScalars)
        guard (1...64).contains(scalars.count), let first = scalars.first else {
            return false
        }
        guard isLetter(first.value) else { return false }

        for scalar in scalars.dropFirst() {
            let code = scalar.value
            let isDigit = (48...57).contains(code)
            if !isLetter(code) && !isDigit && code != 45 && code != 95 {
                return false
            }
        }
        return true
    }

    private static func isLetter(_ code: UInt32) -> Bool {
        (65...90).contains(code) || (97...122).contains(code)
    }
}
