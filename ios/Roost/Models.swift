import Foundation

struct Agent: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let instructions: String
    let character: String
    let model: String
    let kind: String?
}

struct Message: Codable, Identifiable, Equatable {
    let id: String
    let role: String
    let text: String
    let title: String?
    let status: String?
    let details: String?
    let files: [Attachment]?
    let createdAt: Double?
}

struct Attachment: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let mimeType: String
    let size: Int
}

struct Entry: Codable, Identifiable, Equatable {
    let position: Int
    let message: Message
    var id: String { message.id }
}

struct ReplyThread: Codable, Identifiable, Hashable {
    let id: String
    let parentMessageId: String
    let parent: Message
    let replyCount: Int
    let status: String?

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct Snapshot: Decodable {
    let entries: [Entry]
    let revision: Int
    let before: Int?
    let threads: [ReplyThread]
    let busy: Bool
    let runId: String?
    let status: String?
}

struct Approval: Decodable, Identifiable {
    let id: String
    let title: String
    let details: String
    let questions: [Question]?

    struct Question: Decodable, Identifiable {
        let id: String
        let question: String
        let options: [Option]
        let allowOther: Bool

        struct Option: Decodable {
            let label: String
            let description: String
        }
    }
}

struct SendRequest: Codable, Equatable {
    let messageId: String
    let conversationId: String
    let text: String
    let attachmentIds: [String]
}

struct IDResponse: Decodable { let id: String }

struct SessionResponse: Decodable { let apiVersion: Int }

struct APIError: LocalizedError {
    let message: String
    var status: Int? = nil
    var errorDescription: String? { message }
}

struct Connection: Codable, Equatable {
    let server: URL
    let token: String

    static func make(server: String, token: String) throws -> Connection {
        let raw = server.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: raw), let host = url.host, !host.isEmpty,
            url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
            url.path.isEmpty || url.path == "/"
        else {
            throw APIError(
                message:
                    "Enter your server address without a path, for example https://roost.example.com."
            )
        }
        let local = ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)
        guard url.scheme == "https" || (url.scheme == "http" && local) else {
            throw APIError(
                message:
                    "Use HTTPS to protect your device token. HTTP is available only for localhost development."
            )
        }
        let token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            token.range(of: "^roost_mobile_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
        else {
            throw APIError(message: "Paste a Roost device token.")
        }
        return Connection(server: url, token: token)
    }
}
