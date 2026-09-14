import Foundation

struct DashboardSnapshot: Decodable {
    let enabled: Bool
    let widgets: [DashboardWidget]
    let datasets: [DashboardDataset]
}

struct DashboardWidget: Decodable, Identifiable {
    let key: String
    let title: String
    let blocks: [DashboardBlock]
    let updatedAt: Double
    var id: String { key }
}

struct DashboardBlock: Decodable {
    let type: String
    let title: String?
    let text: String?
    let style: String?
    let columns: [String]?
    let rows: [[String]]?
    let items: [Item]?
    let points: [Point]?
    let datasetKey: String?
    let x: String?
    let series: [Series]?
    let chartError: String?

    struct Item: Decodable {
        let label: String
        let value: String?
        let note: String?
        let url: String?
        let status: String?
    }
    struct Point: Decodable {
        let label: String
        let value: Double
    }
    struct Series: Decodable {
        let column: String
        let label: String
    }
}

struct DashboardDataset: Decodable, Identifiable {
    let key: String
    let title: String
    let description: String?
    let sourceUrl: String?
    let columns: [Column]
    let rows: [[DataCell]]
    let revision: Int
    let updatedAt: Double
    var id: String { key }
    struct Column: Decodable {
        let key: String
        let label: String
        let type: String
    }
}

enum DataCell: Decodable {
    case text(String)
    case number(Double)
    case boolean(Bool)
    case empty
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() {
            self = .empty
        } else if let boolean = try? value.decode(Bool.self) {
            self = .boolean(boolean)
        } else if let number = try? value.decode(Double.self) {
            self = .number(number)
        } else {
            self = .text(try value.decode(String.self))
        }
    }
    var text: String {
        switch self {
        case .text(let value): value
        case .number(let value): value.formatted(.number.precision(.significantDigits(1...12)))
        case .boolean(let value): value ? "true" : "false"
        case .empty: "—"
        }
    }
    var number: Double? { if case .number(let number) = self { number } else { nil } }
}

struct CodingJob: Decodable, Identifiable {
    let id: String
    let title: String
    let status: String
    let summary: String
    let brief: String
    let output: String
    let error: String
    let repository: String
    let lastWorkerState: String
    let sessionIdentity: String
    let cancelRequested: Bool
    let revision: Int
    let updatedAt: Double
    let workspace: CodingWorkspace?
    var canStop: Bool { !["completed", "failed", "cancelled"].contains(status) }
    var canMessage: Bool {
        !cancelRequested && !sessionIdentity.isEmpty
            && ["running", "blocked", "review"].contains(status)
            && ["working", "idle", "done"].contains(lastWorkerState)
    }
    var canContinue: Bool {
        canMessage && ["review", "blocked"].contains(status)
            && ["idle", "done"].contains(lastWorkerState)
    }
    func label(_ workspace: CodingWorkspace?) -> String {
        if cancelRequested && canStop { return "Stopping…" }
        if ["completed", "cancelled", "failed", "blocked"].contains(status) {
            return status.capitalized
        }
        if status == "review" && workspace?.workflow == "feedback" { return "Ready for feedback" }
        if status == "review" && workspace?.workflow == "review" { return "Ready for review" }
        return "Working"
    }
}

struct CodingWorkspace: Decodable {
    let conversationId: String
    let workflow: String
    let previewUrl: String
    let previewRevision: String
    let previewAvailability: String
    let previewReportedAt: Double
    let previewExpiresAt: Double
    let latestChanges: String
    let verification: String
    let integration: String
    let pullRequests: [String]

    func previewState(now: Date = .now) -> String {
        guard previewAvailability == "running" else { return previewAvailability }
        let now = now.timeIntervalSince1970 * 1000
        return previewReportedAt > 0 && previewReportedAt <= now && previewExpiresAt > now
            && previewExpiresAt <= previewReportedAt + 900_000 ? "running" : "unknown"
    }
}

struct CodingDetail: Decodable {
    let job: CodingJob
    let workspace: CodingWorkspace
    let feedback: [JobFeedback]
    let messages: [WorkerMessage]
    let queueBlockers: [String]
}
struct JobFeedback: Decodable, Identifiable {
    let id: String
    let text: String
    let previewRevision: String
    let inputId: String?
    let delivery: String?
    let error: String
}
struct WorkerMessage: Decodable, Identifiable {
    let id: String
    let text: String
    let status: String
    let response: String
    let error: String
    let previewCheck: String
}

func workspaceURL(_ value: String) -> URL? {
    guard let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
        url.host != nil, url.user == nil, url.password == nil
    else { return nil }
    return url
}

extension Date {
    init(milliseconds: Double) { self.init(timeIntervalSince1970: milliseconds / 1000) }
}
