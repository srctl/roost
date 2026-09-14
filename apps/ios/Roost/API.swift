import Foundation
import Security

// Never follow a proxy/login redirect with device credentials. Report it so
// the user can use a server endpoint reachable directly by the native app.
final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) { completionHandler(nil) }
}

struct RoostAPI {
    let connection: Connection
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 90
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }()

    func request(
        _ path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil,
        contentType: String = "application/json"
    ) async throws -> Data {
        var components = URLComponents(
            url: connection.server.appendingPathComponent("api/mobile/v1/" + path),
            resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("Bearer " + connection.token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await Self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(message: "The server did not respond.")
        }
        if http.statusCode == 401 {
            throw APIError(
                message:
                    "Your device token expired or was revoked. Reconnect in Settings with a new token."
            )
        }
        if (300...399).contains(http.statusCode) {
            throw APIError(
                message:
                    "This address redirects to a browser sign-in. Use a direct HTTPS endpoint for the mobile API."
            )
        }
        guard (200...299).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode([String: String].self, from: data)
            throw APIError(
                message: error?["error"] ?? "Roost returned an error (\(http.statusCode)).",
                status: http.statusCode)
        }
        return data
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await request(path, query: query)
        do { return try JSONDecoder().decode(T.self, from: data) } catch {
            throw APIError(
                message:
                    "This server does not support this version of the Roost app. Update Roost and check the server address."
            )
        }
    }

    func post<T: Encodable>(_ path: String, _ value: T) async throws -> Data {
        try await request(path, method: "POST", body: JSONEncoder().encode(value))
    }

    func upload(agentId: String, name: String, mimeType: String, bytes: Data) async throws
        -> Attachment
    {
        guard bytes.count <= 20 * 1024 * 1024 else {
            throw APIError(message: "Choose a file smaller than 20 MB.")
        }
        let boundary = UUID().uuidString
        let safeName = name.replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        var body = Data(
            "--\(boundary)\r\nContent-Disposition: form-data; name=\"agentId\"\r\n\r\n\(agentId)\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\nContent-Type: \(mimeType)\r\n\r\n"
                .utf8)
        body.append(bytes)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let data = try await request(
            "files", method: "POST", body: body,
            contentType: "multipart/form-data; boundary=\(boundary)")
        return try JSONDecoder().decode(Attachment.self, from: data)
    }
}

enum SecureConnection {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "dev.roost.iphone", kSecAttrAccount as String: "connection",
    ]

    static func load() throws -> Connection? {
        var query = query
        query[kSecReturnData as String] = true
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else {
            throw APIError(message: "Unlock your iPhone to access your saved connection.")
        }
        return try JSONDecoder().decode(Connection.self, from: data)
    }

    static func save(_ connection: Connection) throws {
        let data = try JSONEncoder().encode(connection)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let insert = query.merging(attributes) { _, new in new }
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
                throw APIError(message: "Could not save the connection securely.")
            }
        } else if status != errSecSuccess {
            throw APIError(message: "Could not update the saved connection.")
        }
    }

    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw APIError(
                message:
                    "Could not remove the saved connection. Try again after unlocking your phone.")
        }
    }
}
