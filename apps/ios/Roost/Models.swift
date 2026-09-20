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
    var ui: MessageUI? = nil
}

struct MessageUI: Codable, Equatable {
    let type: String
    let key: String
    var dashboardKey: String? {
        guard type == "dashboard",
            key.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) == key
                .startIndex..<key.endIndex
        else { return nil }
        return key
    }
}

extension MessageUI {
    private struct Field: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Field.self)
        guard Set(values.allKeys.map(\.stringValue)) == ["type", "key"] else {
            throw DecodingError.dataCorrupted(
                .init(
                    codingPath: decoder.codingPath,
                    debugDescription: "Unsupported message UI fields"))
        }
        type = try values.decode(String.self, forKey: Field(stringValue: "type"))
        key = try values.decode(String.self, forKey: Field(stringValue: "key"))
    }
}

extension Message {
    private enum CodingKeys: String, CodingKey {
        case id, role, text, title, status, details, files, createdAt, ui
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        role = try values.decode(String.self, forKey: .role)
        text = try values.decode(String.self, forKey: .text)
        title = try values.decodeIfPresent(String.self, forKey: .title)
        status = try values.decodeIfPresent(String.self, forKey: .status)
        details = try values.decodeIfPresent(String.self, forKey: .details)
        files = try values.decodeIfPresent([Attachment].self, forKey: .files)
        createdAt = try values.decodeIfPresent(Double.self, forKey: .createdAt)
        ui = try? values.decode(MessageUI.self, forKey: .ui)
    }
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
    let runId: String
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
    var code: String? = nil
    var errorDescription: String? { message }

    // A generic server error can occur after enqueueing. Only explicit
    // pre-enqueue rejections, authentication, and routing failures are safe
    // to edit and resend with a new message identity.
    var rejectsMessage: Bool {
        code == "message_rejected" || [401, 403, 404, 405, 413, 415, 422].contains(status ?? 0)
    }
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
