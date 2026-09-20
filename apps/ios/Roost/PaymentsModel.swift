import Foundation
import Observation

struct PaymentSettings: Decodable {
    let connected: Bool
    let email: String?
    let connection: PaymentConnection?
    let purchases: [PaymentPurchase]
}

struct PaymentConnection: Decodable {
    let verificationUrl: String
    let userCode: String
    let expiresAt: Double

    func isExpired(now: Date = Date()) -> Bool {
        Date(milliseconds: expiresAt) <= now
    }
}

struct PaymentPurchase: Decodable, Identifiable {
    let id: String
    let agentId: String
    let merchantName: String
    let merchantUrl: String
    let description: String
    let amount: Int
    let currency: String
    let status: String
    let approvalUrl: String?
    let createdAt: Double
    let updatedAt: Double
    let error: String?
    var orderReference: String? = nil
    var receiptUrl: String? = nil

    var awaitingApproval: Bool {
        status == "awaiting_approval"
    }
    var needsLinkAction: Bool { awaitingApproval || status == "requires_action" }

    var statusLabel: String {
        switch status {
        case "creating": "Preparing approval"
        case "awaiting_approval": "Awaiting approval in Link"
        case "approved": "Approved in Link"
        case "requires_action": "Verification required in Link"
        case "processing": "Processing"
        case "completed": "Completed"
        case "declined": "Declined"
        case "canceled": "Canceled"
        case "expired": "Expired"
        case "failed": "Failed"
        default: "Status unavailable"
        }
    }

    var total: String { formattedTotal() }

    func formattedTotal(locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currency.uppercased()
        let divisor = pow(Decimal(10), formatter.maximumFractionDigits)
        return formatter.string(from: NSDecimalNumber(decimal: Decimal(amount) / divisor))
            ?? "\(amount) \(currency.uppercased()) minor units"
    }
}

// Provider links open in the system browser, never through the authenticated
// Roost API session. Refuse arbitrary destinations even if the server sends one.
func linkPaymentURL(_ value: String?) -> URL? {
    guard let value, let url = URL(string: value), url.scheme?.lowercased() == "https",
        ["link.com", "app.link.com", "login.link.com"].contains(url.host?.lowercased() ?? ""),
        url.user == nil, url.password == nil,
        url.port == nil || url.port == 443
    else { return nil }
    return url
}

@MainActor @Observable final class PaymentsModel {
    let api: RoostAPI
    let agentId: String?
    var settings: PaymentSettings?
    var error: String?
    var working = false
    private var refreshing = false
    var busy: Bool { working || refreshing }
    var needsProviderPolling: Bool {
        if let connection = settings?.connection, !connection.isExpired() { return true }
        return purchases.contains { $0.awaitingApproval }
    }

    var purchases: [PaymentPurchase] {
        (settings?.purchases ?? []).filter { agentId == nil || $0.agentId == agentId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    init(api: RoostAPI, agentId: String? = nil) {
        self.api = api
        self.agentId = agentId
    }

    func refresh(pollProvider: Bool = true) async {
        guard !working, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            if pollProvider {
                settings = try JSONDecoder()
                    .decode(
                        PaymentSettings.self,
                        from: await api.post("payments/refresh", [String: String]()))
            } else {
                settings = try await api.get(
                    "payments",
                    query: agentId.map { [URLQueryItem(name: "agentId", value: $0)] } ?? [])
            }
            error = nil
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    func connect() async -> URL? {
        guard !working, !refreshing else { return nil }
        working = true
        error = nil
        defer { working = false }
        do {
            settings = try JSONDecoder()
                .decode(
                    PaymentSettings.self,
                    from: await api.post("payments/connect", [String: String]()))
            guard let connection = settings?.connection else { return nil }
            guard let url = linkPaymentURL(connection.verificationUrl) else {
                throw APIError(message: "Roost returned an unsupported Link sign-in address.")
            }
            return url
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func disconnect() async {
        guard !working, !refreshing else { return }
        working = true
        error = nil
        defer { working = false }
        do {
            settings = try JSONDecoder()
                .decode(
                    PaymentSettings.self,
                    from: await api.request("payments/connection", method: "DELETE"))
        } catch { self.error = error.localizedDescription }
    }
}
