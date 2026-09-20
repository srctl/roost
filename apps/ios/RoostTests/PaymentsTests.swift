import XCTest

@testable import Roost

final class PaymentsTests: XCTestCase {
    func testPaymentSnapshotDecodesPendingConnectionAndPurchaseWithoutCredentials() throws {
        let json = #"""
            {"connected":false,"email":null,"connection":{"verificationUrl":"https://app.link.com/connect","userCode":"ABCD-EFGH","expiresAt":2000},"purchases":[{"id":"purchase-1","agentId":"agent-1","merchantName":"Book shop","merchantUrl":"https://books.example","description":"A cookbook","amount":2499,"currency":"usd","status":"awaiting_approval","approvalUrl":"https://app.link.com/approve/1","createdAt":1000,"updatedAt":1500,"error":null}],"futureField":true}
            """#
        let settings = try JSONDecoder().decode(PaymentSettings.self, from: Data(json.utf8))
        XCTAssertFalse(settings.connected)
        let connection = try XCTUnwrap(settings.connection)
        XCTAssertEqual(connection.userCode, "ABCD-EFGH")
        XCTAssertFalse(connection.isExpired(now: Date(milliseconds: 1999)))
        XCTAssertTrue(connection.isExpired(now: Date(milliseconds: 2000)))
        let purchase = try XCTUnwrap(settings.purchases.first)
        XCTAssertEqual(purchase.amount, 2499)
        XCTAssertEqual(purchase.createdAt, 1000)
        XCTAssertTrue(purchase.awaitingApproval)
        XCTAssertEqual(purchase.statusLabel, "Awaiting approval in Link")
    }

    func testPaymentLinksRequireExactProviderHTTPSOriginWithoutCredentials() {
        for value in [
            "http://app.link.com/approve", "https://app.link.com.evil.example/approve",
            "https://evil.example/app.link.com", "https://user:secret@app.link.com/approve",
            "https://app.link.com@evil.example/approve", "https://app.link.com:8080/approve",
            "javascript:alert(1)", "file:///tmp/approve", "https://app.link.com./approve",
        ] {
            XCTAssertNil(linkPaymentURL(value), value)
        }
        XCTAssertNil(linkPaymentURL(nil))
        XCTAssertNotNil(linkPaymentURL("https://app.link.com/approve?id=test"))
        XCTAssertNotNil(linkPaymentURL("https://app.link.com:443/approve?id=test"))
        XCTAssertNotNil(linkPaymentURL("https://link.com/verify"))
        XCTAssertNotNil(linkPaymentURL("https://login.link.com/verify"))
    }

    @MainActor func testAgentPurchaseListFiltersOtherAgentsAndSortsNewestFirst() throws {
        let model = PaymentsModel(
            api: RoostAPI(
                connection: Connection(
                    server: URL(string: "https://roost.example")!, token: "test-only")),
            agentId: "agent-1")
        model.settings = PaymentSettings(
            connected: true, email: nil, connection: nil,
            purchases: [
                purchase(id: "older", agentId: "agent-1", createdAt: 1000),
                purchase(id: "other", agentId: "agent-2", createdAt: 3000),
                purchase(id: "newer", agentId: "agent-1", createdAt: 2000),
            ])
        XCTAssertEqual(model.purchases.map(\.id), ["newer", "older"])
    }

    func testApprovalDoesNotMeanCompletedAndUnknownStatusesHaveNoApprovalAction() {
        let approved = purchase(status: "approved")
        XCTAssertEqual(approved.statusLabel, "Approved in Link")
        XCTAssertFalse(approved.awaitingApproval)
        let unknown = purchase(status: "future_status")
        XCTAssertEqual(unknown.statusLabel, "Status unavailable")
        XCTAssertFalse(unknown.awaitingApproval)
        XCTAssertFalse(unknown.needsLinkAction)
        XCTAssertTrue(purchase(status: "requires_action").needsLinkAction)
        XCTAssertFalse(purchase(status: "requires_action").awaitingApproval)
        XCTAssertEqual(purchase(status: "processing").statusLabel, "Processing")
        XCTAssertFalse(purchase(status: "processing").needsLinkAction)
    }

    func testTotalsRespectCurrencyMinorUnits() {
        let locale = Locale(identifier: "en_US")
        XCTAssertEqual(purchase().formattedTotal(locale: locale), "$24.99")
        XCTAssertEqual(purchase(currency: "jpy").formattedTotal(locale: locale), "¥2,499")
        XCTAssertTrue(purchase(currency: "kwd").formattedTotal(locale: locale).hasSuffix("2.499"))
    }

    private func purchase(
        id: String = "purchase", agentId: String = "agent-1", status: String = "completed",
        createdAt: Double = 1000, currency: String = "usd"
    ) -> PaymentPurchase {
        PaymentPurchase(
            id: id, agentId: agentId, merchantName: "Book shop",
            merchantUrl: "https://books.example", description: "A cookbook", amount: 2499,
            currency: currency, status: status, approvalUrl: "https://app.link.com/approve/1",
            createdAt: createdAt, updatedAt: createdAt, error: nil)
    }
}
