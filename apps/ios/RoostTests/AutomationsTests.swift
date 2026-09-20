import XCTest

@testable import Roost

final class AutomationsTests: XCTestCase {
    func testEditingPreservesWallClockTimezoneAndDateRange() throws {
        let json = """
            {"id":"automation","agentId":"agent","name":"Morning report","prompt":"Review priorities","schedule":{"kind":"weekly","timezone":"Asia/Tokyo","days":[1,3,5],"time":"07:45","startsOn":"2030-01-01","endsOn":"2030-02-01"},"notification":"always","model":"model-override","revision":7,"enabled":false,"nextRunAt":null}
            """
        let automation = try JSONDecoder().decode(AgentAutomation.self, from: Data(json.utf8))
        let draft = AutomationDraft(automation: automation)
        XCTAssertEqual(draft.schedule, automation.schedule)
        XCTAssertEqual(draft.expectedRevision, 7)
        XCTAssertEqual(draft.model, "model-override")
        XCTAssertTrue(draft.valid)
        let encoded = try JSONEncoder().encode(AutomationSave(draft: draft))
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertEqual(value["expectedRevision"] as? Int, 7)
        XCTAssertEqual(value["model"] as? String, "model-override")
    }

    func testAgentDefaultEncodesNullRatherThanOmittingModel() throws {
        var draft = AutomationDraft()
        draft.name = "  Morning report  "
        draft.prompt = "  Check priorities\n"
        let encoded = try JSONEncoder().encode(AutomationSave(draft: draft))
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertTrue(value["model"] is NSNull)
        XCTAssertNil(value["expectedRevision"])
        XCTAssertEqual(value["name"] as? String, "Morning report")
        XCTAssertEqual(value["prompt"] as? String, "Check priorities")
    }

    func testOneTimeDatesFromWebKeepTheirInstant() throws {
        let date = "2030-07-10T09:45:00.000Z"
        let json = """
            {"id":"automation","agentId":"agent","name":"Reminder","prompt":"Remind me","schedule":{"kind":"once","timezone":"America/Los_Angeles","at":"\(date)"},"notification":"always","revision":2,"enabled":true,"nextRunAt":1910000000000}
            """
        let automation = try JSONDecoder().decode(AgentAutomation.self, from: Data(json.utf8))
        let draft = AutomationDraft(automation: automation)
        XCTAssertEqual(draft.at, AutomationSchedule.parseDate(date))
        XCTAssertEqual(
            AutomationSchedule.parseDate(draft.schedule.at), AutomationSchedule.parseDate(date))
        XCTAssertNil(draft.schedule.startsOn)
        XCTAssertNil(draft.schedule.days)
    }

    func testChangingScheduleRemovesUnrelatedFieldsAndValidatesLimits() {
        var draft = AutomationDraft()
        draft.name = "Report"
        draft.prompt = "Check priorities"
        draft.kind = "interval"
        draft.minutes = "90"
        XCTAssertTrue(draft.valid)
        XCTAssertEqual(draft.schedule.minutes, 90)
        XCTAssertNil(draft.schedule.days)
        XCTAssertNil(draft.schedule.time)
        draft.minutes = "0"
        XCTAssertFalse(draft.valid)
        draft.minutes = "525601"
        XCTAssertFalse(draft.valid)
        draft.kind = "weekly"
        draft.days = []
        XCTAssertFalse(draft.valid)
        draft.days = [1]
        draft.timezone = "Not/A/Zone"
        XCTAssertFalse(draft.valid)
        draft.timezone = "UTC"
        draft.kind = "cron"
        draft.expression = "0 9 * * *"
        XCTAssertTrue(draft.valid)
        XCTAssertNil(draft.schedule.minutes)
        XCTAssertEqual(draft.schedule.expression, "0 9 * * *")
    }

    func testRunOutputDecodesActivitiesAndExcludesDuplicatedUserPrompt() throws {
        let messages: [[String: String]] = [
            ["id": "u", "role": "user", "text": "Check"],
            ["id": "a", "role": "assistant", "text": "Ready"],
            [
                "id": "t", "role": "activity", "text": "done", "title": "Search",
                "details": "Result",
            ],
        ]
        let value: [String: Any] = [
            "id": "run", "status": "succeeded", "createdAt": 1, "prompt": "Check",
            "messages": String(
                data: try JSONSerialization.data(withJSONObject: messages), encoding: .utf8)!,
        ]
        let run = try JSONDecoder()
            .decode(AutomationRun.self, from: JSONSerialization.data(withJSONObject: value))
        XCTAssertEqual(run.output.map(\.id), ["a", "t"])
        XCTAssertEqual(run.output.last?.details, "Result")
        XCTAssertFalse(run.active)
    }
}
