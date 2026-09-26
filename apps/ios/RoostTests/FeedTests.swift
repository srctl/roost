import XCTest

@testable import Roost

final class FeedTests: XCTestCase {
    private func item(
        id: String = "story", publishedAt: Date? = nil, createdAt: Date? = nil,
        read: Bool = false, saved: Bool = false, dismissed: Bool = false, kind: String = "article"
    ) throws -> FeedItem {
        let value: [String: Any] = [
            "id": id, "kind": kind, "title": "A new park", "summary": "A neighborhood update",
            "body": "The original article is linked below.", "url": "https://example.com/park",
            "sourceName": "CHS",
            "publishedAt": publishedAt.map { $0.timeIntervalSince1970 * 1000 }
                ?? 1_790_000_000_000,
            "createdAt": createdAt.map { $0.timeIntervalSince1970 * 1000 } ?? 1_790_000_001_000,
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
        XCTAssertNil(article.personalScores, "Older servers omit personal scores.")
    }

    func testPersonalScoresDecodeIndependentlyFromLegacyCombinedScore() throws {
        let data = try JSONEncoder().encode(item())
        var value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        value["personalScores"] = [
            "interest": 0.9, "usefulness": 0.4, "confidence": 0.65, "model": "jev-1.13.0",
        ]
        let article = try JSONDecoder()
            .decode(
                FeedItem.self, from: JSONSerialization.data(withJSONObject: value))
        let scores = try XCTUnwrap(article.personalScores)
        XCTAssertEqual(scores.interest, 0.9)
        XCTAssertEqual(scores.usefulness, 0.4)
        XCTAssertEqual(scores.confidence, 0.65)
        XCTAssertEqual(scores.model, "jev-1.13.0")
        XCTAssertEqual(article.score, 0.8)
    }

    func testOnlyAllAndSavedAreExposedAndReadStateDoesNotFilterEither() throws {
        XCTAssertEqual(FeedFilter.allCases, [.all, .saved])
        XCTAssertNil(FeedFilter(rawValue: "unread"))
        XCTAssertTrue(FeedFilter.all.includes(try item(read: true)))
        XCTAssertTrue(FeedFilter.all.includes(try item(read: false)))
        XCTAssertTrue(FeedFilter.saved.includes(try item(read: true, saved: true)))
        XCTAssertTrue(FeedFilter.saved.includes(try item(read: false, saved: true)))
        XCTAssertFalse(FeedFilter.saved.includes(try item()))
        for filter in FeedFilter.allCases {
            XCTAssertFalse(filter.includes(try item(saved: true, dismissed: true)))
        }
    }

    private func date(_ value: String) throws -> Date {
        try XCTUnwrap(ISO8601DateFormatter().date(from: value))
    }

    private func calendar(_ zone: String) throws -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: zone))
        return calendar
    }

    func testTodayUsesLocalNoonAndFivePMBoundariesWithNewestItemsFirst() throws {
        let calendar = try calendar("America/Los_Angeles")
        let now = try date("2026-09-20T04:00:00Z")
        let sections = try FeedSection.grouped(
            [
                item(id: "noon", publishedAt: date("2026-09-19T19:00:00Z")),
                item(id: "morning", publishedAt: date("2026-09-19T18:59:59Z")),
                item(id: "evening", publishedAt: date("2026-09-20T00:00:00Z")),
                item(id: "late-afternoon", publishedAt: date("2026-09-19T23:59:59Z")),
                item(id: "late-evening", publishedAt: date("2026-09-20T03:00:00Z")),
                item(id: "midnight", publishedAt: date("2026-09-19T07:00:00Z")),
            ], now: now, calendar: calendar, locale: Locale(identifier: "en_US"))
        XCTAssertEqual(sections.map(\.title), ["This evening", "This afternoon", "This morning"])
        XCTAssertEqual(
            sections.map { $0.items.map(\.id) },
            [["late-evening", "evening"], ["late-afternoon", "noon"], ["morning", "midnight"]])
        XCTAssertEqual(Set(sections.map(\.id)).count, 3)
    }

    func testTimezoneDeterminesTodayAndYesterdayAcrossUTCMidnight() throws {
        let now = try date("2026-09-20T06:30:00Z")
        let items = try [
            item(id: "today", publishedAt: date("2026-09-20T00:30:00Z")),
            item(id: "yesterday", publishedAt: date("2026-09-19T06:59:59Z")),
            item(id: "older", publishedAt: date("2026-09-18T06:59:59Z")),
        ]
        let local = try FeedSection.grouped(
            items, now: now, calendar: calendar("America/Los_Angeles"),
            locale: Locale(identifier: "en_US"))
        XCTAssertEqual(local.map(\.title), ["This evening", "Yesterday", "September 17, 2026"])
        let utc = try FeedSection.grouped(
            items, now: now, calendar: calendar("UTC"), locale: Locale(identifier: "en_US"))
        XCTAssertEqual(utc.map(\.title), ["This morning", "Yesterday", "September 18, 2026"])
    }

    func testSpringDaylightSavingUsesCalendarYesterdayInsteadOfTwentyFourHours() throws {
        let sections = try FeedSection.grouped(
            [
                item(id: "saturday", publishedAt: date("2026-03-08T07:50:00Z")),
                item(id: "sunday", publishedAt: date("2026-03-09T06:30:00Z")),
            ], now: date("2026-03-09T07:30:00Z"),
            calendar: calendar("America/Los_Angeles"), locale: Locale(identifier: "en_US"))
        XCTAssertEqual(sections.map(\.title), ["Yesterday", "March 7, 2026"])
        XCTAssertEqual(sections.map { $0.items.map(\.id) }, [["sunday"], ["saturday"]])
    }

    func testFallRepeatedHourStaysInOneDayAndOrdersByPublishedInstant() throws {
        let sections = try FeedSection.grouped(
            [
                item(id: "first-130", publishedAt: date("2026-11-01T08:30:00Z")),
                item(id: "second-130", publishedAt: date("2026-11-01T09:30:00Z")),
            ], now: date("2026-11-02T08:30:00Z"),
            calendar: calendar("America/Los_Angeles"), locale: Locale(identifier: "en_US"))
        XCTAssertEqual(sections.map(\.title), ["Yesterday"])
        XCTAssertEqual(sections.first?.items.map(\.id), ["second-130", "first-130"])
    }

    func testGroupingIgnoresImportTimeAndUsesStableIDsForEqualPublicationTimes() throws {
        let published = try date("2026-09-18T12:00:00Z")
        let now = try date("2026-09-20T12:00:00Z")
        let sections = try FeedSection.grouped(
            [
                item(id: "b", publishedAt: published, createdAt: now),
                item(id: "a", publishedAt: published, createdAt: published),
                item(id: "older", publishedAt: date("2026-09-17T12:00:00Z"), createdAt: now),
            ], now: now, calendar: calendar("UTC"), locale: Locale(identifier: "en_US"))
        XCTAssertEqual(sections.map(\.title), ["September 18, 2026", "September 17, 2026"])
        XCTAssertEqual(sections.map { $0.items.map(\.id) }, [["a", "b"], ["older"]])
        XCTAssertTrue(FeedSection.grouped([], now: now).isEmpty)
    }

    func testRestoreAfterRefreshReinsertsStoryAtItsPublishedPositionWithoutDuplicates() throws {
        let published = try date("2026-09-19T09:00:00Z")
        let restored = try item(id: "restored", publishedAt: published, saved: true)
        let dismissed = try item(
            id: restored.id, publishedAt: published, saved: true, dismissed: true)
        let newer = try item(id: "newer", publishedAt: date("2026-09-19T17:00:00Z"))
        var items = FeedModel.applying(dismissed, action: "dismiss", to: [restored, newer])
        XCTAssertEqual(items.filter(FeedFilter.all.includes).map(\.id), ["newer"])

        // The next GET excludes dismissed items, while Undo still has its receipt.
        items = [newer]
        items = FeedModel.applying(restored, action: "restore", to: items)
        XCTAssertEqual(items.filter(FeedFilter.saved.includes).map(\.id), [restored.id])
        let sections = try FeedSection.grouped(
            items.filter(FeedFilter.all.includes), now: date("2026-09-19T20:00:00Z"),
            calendar: calendar("UTC"), locale: Locale(identifier: "en_US"))
        XCTAssertEqual(sections.map(\.title), ["This evening", "This morning"])
        XCTAssertEqual(sections.flatMap(\.items).map(\.id), [newer.id, restored.id])
        XCTAssertEqual(
            FeedModel.applying(restored, action: "restore", to: items).map(\.id), items.map(\.id),
            "Replaying a restoration must replace the existing row, not duplicate it.")
    }

    func testOtherActionsDoNotInsertStoriesMissingFromCurrentCollection() throws {
        let story = try item(saved: true)
        for action in ["save", "unsave", "dismiss", "less", "more", "read", "unread"] {
            XCTAssertTrue(FeedModel.applying(story, action: action, to: []).isEmpty, action)
        }
        let original = try item(saved: false)
        let updated = FeedModel.applying(story, action: "save", to: [original])
        XCTAssertEqual(updated.count, 1)
        XCTAssertTrue(try XCTUnwrap(updated.first).saved)
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
