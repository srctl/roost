import CryptoKit
import Foundation

struct SavedDraft: Codable {
    let text: String
    let attachments: [Attachment]
    let pending: SendRequest?
}

enum Drafts {
    private static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("RoostDrafts", isDirectory: true)
    }

    private static func url(server: URL, agent: String, conversation: String) -> URL {
        let identity = "\(server.absoluteString)|\(agent)|\(conversation)"
        let hash = SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }
            .joined()
        return directory.appendingPathComponent(hash + ".json")
    }

    static func load(server: URL, agent: String, conversation: String) throws -> SavedDraft? {
        let url = url(server: server, agent: agent, conversation: conversation)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(SavedDraft.self, from: Data(contentsOf: url))
    }

    static func save(_ draft: SavedDraft, server: URL, agent: String, conversation: String) throws {
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete])
        var directory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        let url = url(server: server, agent: agent, conversation: conversation)
        if draft.text.isEmpty && draft.attachments.isEmpty && draft.pending == nil {
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
        } else {
            try JSONEncoder().encode(draft)
                .write(to: url, options: [.atomic, .completeFileProtection])
        }
    }

    static func clear() throws {
        if FileManager.default.fileExists(atPath: directory.path) {
            try FileManager.default.removeItem(at: directory)
        }
    }

    static func clearPreviews() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "RoostPreviews", isDirectory: true)
        try? FileManager.default.removeItem(at: directory)
    }
}
