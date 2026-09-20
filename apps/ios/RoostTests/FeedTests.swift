import XCTest

@testable import Roost

final class FeedTests: XCTestCase {
    private func item(
        read: Bool = false, saved: Bool = false, dismissed: Bool = false, kind: String = "article"
    ) throws -> FeedItem {
        let value: [String: Any] = [
            "id": "story", "kind": kind, "title": "A new park", "summary": "A neighborhood update",
            "body": "The original article is linked below.", "url": "https://example.com/park",
            "sourceName": "CHS", "publishedAt": 1_790_000_000_000, "createdAt": 1_790_000_001_000,
            "readAt": read ? 1_790_000_002_000 : NSNull(), "saved": saved, "dismissed": dismissed,
            "topics": ["Seattle"], "why": "You follow neighborhood news.", "importance": "normal",
            "score": 0.8, "scoring": "jev",
            "citations": [["title": "Original", "url": "https://example.com/park"]],
        ]
        return try JSONDecoder()
            .decode(FeedItem.self, from: JSONSerialization.data(withJSONObject: value))
    }

    func testFeedContractDecodesMillisecondDatesAndAttribution() throws {
        let article = try item()
        XCTAssertEqual(Date(milliseconds: article.publishedAt).timeIntervalSince1970, 1_790_000_000)
        XCTAssertNil(article.imageUrl)
        XCTAssertEqual(article.attribution, "CHS")
        XCTAssertEqual(try item(kind: "story").attribution, "Roost story · CHS")
        XCTAssertEqual(try item(kind: "update").attribution, "Personal update · CHS")
        XCTAssertEqual(article.citations.first?.url, "https://example.com/park")
    }

    func testSavedUnreadAndDismissedStateStayIndependent() throws {
        XCTAssertTrue(FeedFilter.all.includes(try item(read: true)))
        XCTAssertFalse(FeedFilter.unread.includes(try item(read: true)))
        XCTAssertTrue(FeedFilter.unread.includes(try item(saved: true)))
        XCTAssertTrue(FeedFilter.saved.includes(try item(read: true, saved: true)))
        XCTAssertFalse(FeedFilter.saved.includes(try item()))
        for filter in FeedFilter.allCases {
            XCTAssertFalse(filter.includes(try item(saved: true, dismissed: true)))
        }
    }

    func testPreferencesExplicitlyClearAgentAndNeverRoundTripKeyMetadata() throws {
        let settings = FeedSettings(
            revision: 4, enabled: true, interests: "Seattle", priorities: "Travel", agentId: nil,
            refreshMinutes: 60, sources: [], emailEnabled: false, jevEnabled: true,
            scorePrivateUpdates: false, jevConfigured: true, jevKeySource: "environment")
        let data = try JSONEncoder().encode(FeedSettingsWrite(settings: settings, apiKey: "  "))
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(
            value["agentId"] is NSNull, "Selecting Publications only must clear the server agent.")
        XCTAssertNil(value["apiKey"], "Blank key must leave the saved key unchanged.")
        XCTAssertNil(value["jevConfigured"])
        XCTAssertNil(value["jevKeySource"])
        XCTAssertEqual(value["revision"] as? Int, 4)
        XCTAssertEqual(value["scorePrivateUpdates"] as? Bool, false)

        let replacement = try JSONEncoder()
            .encode(FeedSettingsWrite(settings: settings, apiKey: "  replacement-key\n"))
        let replacementValue = try XCTUnwrap(
            JSONSerialization.jsonObject(with: replacement) as? [String: Any])
        XCTAssertEqual(replacementValue["apiKey"] as? String, "replacement-key")
    }
}
