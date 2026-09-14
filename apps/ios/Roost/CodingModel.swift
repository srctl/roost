import Foundation
import Observation

struct WorkerSend: Codable, Equatable {
    let requestId: String
    let text: String
}
struct FeedbackSend: Codable {
    let requestId: String
    let text: String
    let previewRevision: String
}
struct FeedbackContinuation: Codable {
    let requestId: String
    let messageIds: [String]
    let revision: Int
}
struct CodingDraft: Codable {
    var message = ""
    var feedback = ""
    var workerRequest: WorkerSend?
    var feedbackRequest: FeedbackSend?
    var continuation: FeedbackContinuation?
}

@MainActor @Observable final class CodingModel {
    let api: RoostAPI
    let agent: Agent
    let id: String
    var detail: CodingDetail?
    var draft = CodingDraft()
    var selected: Set<String> = []
    var error: String?
    var busy = false
    private var refreshing = false
    private var path: String { "agents/\(agent.id)/jobs/\(id)" }
    private var draftURL: URL { WorkspaceDrafts.url(api: api, agent: agent.id, key: "job-\(id)") }

    init(api: RoostAPI, agent: Agent, id: String) {
        self.api = api
        self.agent = agent
        self.id = id
        do {
            draft = try WorkspaceDrafts.load(CodingDraft.self, from: draftURL) ?? CodingDraft()
        } catch { self.error = "Could not restore your draft. " + error.localizedDescription }
    }
    func persist() {
        do { try WorkspaceDrafts.save(draft, to: draftURL) } catch {
            self.error = "Could not save your draft. " + error.localizedDescription
        }
    }
    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let next: CodingDetail = try await api.get(path)
            detail = next
            if let request = draft.workerRequest,
                next.messages.contains(where: { $0.id == request.requestId })
            {
                if draft.message == request.text { draft.message = "" }
                draft.workerRequest = nil
                persist()
            }
            if let request = draft.feedbackRequest,
                next.feedback.contains(where: { $0.id == request.requestId })
            {
                if draft.feedback == request.text { draft.feedback = "" }
                draft.feedbackRequest = nil
                selected.insert(request.requestId)
                persist()
            }
            if let request = draft.continuation,
                next.feedback.contains(where: { $0.inputId == request.requestId })
            {
                draft.continuation = nil
                selected.removeAll()
                persist()
            }
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func sendWorker() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            if draft.workerRequest == nil {
                let text = draft.message.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty && text.count <= 16_000 else { return }
                draft.workerRequest = WorkerSend(requestId: UUID().uuidString, text: text)
            }
            try WorkspaceDrafts.save(draft, to: draftURL)
            let request = draft.workerRequest!
            _ = try await api.post(path + "/messages", request)
            if draft.message.trimmingCharacters(in: .whitespacesAndNewlines) == request.text {
                draft.message = ""
            }
            draft.workerRequest = nil
            try WorkspaceDrafts.save(draft, to: draftURL)
            await refresh()
        } catch {
            self.error = error.localizedDescription
            if [400, 409].contains((error as? APIError)?.status ?? 0) {
                draft.workerRequest = nil
                persist()
                await refresh()
            }
        }
    }
    func saveFeedback() async {
        guard !busy, let detail else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            if draft.feedbackRequest == nil {
                let text = draft.feedback.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty && text.count <= 16_000 else { return }
                draft.feedbackRequest = FeedbackSend(
                    requestId: UUID().uuidString, text: text,
                    previewRevision: detail.workspace.previewRevision)
            }
            try WorkspaceDrafts.save(draft, to: draftURL)
            let request = draft.feedbackRequest!
            _ = try await api.post(path + "/feedback", request)
            selected.insert(request.requestId)
            draft.feedback = ""
            draft.feedbackRequest = nil
            try WorkspaceDrafts.save(draft, to: draftURL)
            await refresh()
        } catch {
            self.error = error.localizedDescription
            if [400, 409].contains((error as? APIError)?.status ?? 0) {
                draft.feedbackRequest = nil
                persist()
                await refresh()
            }
        }
    }
    func resume() async {
        guard !busy, let detail else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            if draft.continuation == nil {
                guard !selected.isEmpty && selected.count <= 50 else { return }
                draft.continuation = FeedbackContinuation(
                    requestId: UUID().uuidString, messageIds: selected.sorted(),
                    revision: detail.job.revision)
            }
            try WorkspaceDrafts.save(draft, to: draftURL)
            _ = try await api.post(path + "/continue", draft.continuation!)
            draft.continuation = nil
            selected.removeAll()
            try WorkspaceDrafts.save(draft, to: draftURL)
            await refresh()
        } catch {
            self.error = error.localizedDescription
            if [400, 409].contains((error as? APIError)?.status ?? 0) {
                draft.continuation = nil
                persist()
                await refresh()
            }
        }
    }
    func action(_ action: String, input: [String: String] = [:]) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await api.post(path + "/" + action, input)
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}
