import CryptoKit
import Foundation

// Device-local recovery, scoped to server and agent. The server remains the
// source of truth; frozen request IDs make an explicit retry safe after a crash.
enum WorkspaceDrafts {
    static func url(api: RoostAPI, agent: String, key: String) -> URL {
        let hash = SHA256.hash(data: Data("\(api.connection.server)|\(agent)|\(key)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RoostDrafts", isDirectory: true)
            .appendingPathComponent("workspace-\(hash).json")
    }
    static func load<T: Decodable>(_ type: T.Type, from url: URL) throws -> T? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(type, from: Data(contentsOf: url))
    }
    static func save<T: Encodable>(_ value: T, to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete])
        var directoryURL = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directoryURL.setResourceValues(values)
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtection])
    }
}
