import JuxiSwiftUI
import SwiftUI
import XCTest

@testable import Roost

final class CodingHandoffTests: XCTestCase {
    private let jobID = "238da3a7-bc21-4c87-80eb-f79a433ef60e"
    @MainActor func testEveryAuthoredHandoffBindsCurrentJob() throws {
        for view in CodingHandoffView.allCases {
            let result = try CodingHandoffBinding.prepare(
                plan: plan(view: view), jobId: jobID, view: view
            ) { _ in Text("Job") }
            XCTAssertEqual(result.nodeIDs, ["handoff/content"])
        }
    }
    @MainActor func testForeignJobsMismatchedViewsAndUnapprovedComponentsAreRejected() throws {
        for invalid in [
            try plan(view: .review, job: UUID().uuidString),
            try plan(view: .tryIt),
            try plan(view: .review, component: "UnapprovedView"),
        ] {
            XCTAssertThrowsError(
                try CodingHandoffBinding.prepare(plan: invalid, jobId: jobID, view: .review) { _ in
                    EmptyView()
                })
        }
    }
    func testFuturePlansDecodeToSafeFallbackWithoutLosingJobData() throws {
        let data = Data(
            #"{"defaultView":"future-view","availableViews":["overview","future-view"],"plans":{"overview":{"version":2,"nodes":[],"decisions":[]}}}"#
                .utf8)
        let presentation = try JSONDecoder().decode(CodingPresentation.self, from: data)
        XCTAssertEqual(presentation.defaultView, .overview)
        XCTAssertEqual(presentation.availableViews, [.overview])
        XCTAssertTrue(presentation.plans.isEmpty)
    }
    private func plan(
        view: CodingHandoffView, job: String? = nil, component: String = "CodingHandoff"
    ) throws -> JuxiPlan {
        try JuxiPlan(
            nodes: [
                JuxiNode(
                    id: "handoff/content", component: component,
                    props: ["jobId": .string(job ?? jobID), "view": .string(view.rawValue)])
            ],
            decisions: [
                JuxiDecision(
                    slot: "handoff", option: view.rawValue, confidence: 1, reason: .selected)
            ])
    }
}
