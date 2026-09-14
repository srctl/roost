import Foundation
import Observation

struct NoteSpan: Codable, Equatable {
    var text: String
    var bold: Bool?
    var italic: Bool?
    var href: String?
}
struct NoteBlock: Codable, Identifiable, Equatable {
    var id: String = UUID().uuidString
    var type = "paragraph"
    var content: [NoteSpan] = []
    var level: Int?
    var checked: Bool?
    var text: String { content.map(\.text).joined() }
}
struct NoteSnapshot: Codable, Equatable {
    let agentId: String
    let revision: Int
    let blocks: [NoteBlock]
    let instructions: String
    let updatedAt: Double
}
struct NoteRevision: Decodable, Identifiable {
    let revision: Int
    let source: String
    let updatedAt: Double
    var id: Int { revision }
}
struct NoteWrite: Codable {
    let requestId: String
    let revision: Int
    var blocks: [NoteBlock]?
    var instructions: String?
    var targetRevision: Int?
}
struct PendingNoteWrite: Codable {
    let action: String
    let input: NoteWrite
}
struct NoteDraft: Codable {
    var base: NoteSnapshot
    var blocks: [NoteBlock]
    var pending: PendingNoteWrite?
}

// Match the web editor: merge edits to unchanged blocks only. Reordering or
// competing edits to a block require a deliberate user choice.
func reconcileNote(base: [NoteBlock], local: [NoteBlock], remote: [NoteBlock]) -> [NoteBlock]? {
    var result = remote
    for old in base {
        let next = local.first { $0.id == old.id }
        if next == old { continue }
        let index = result.firstIndex { $0.id == old.id }
        let current = index.map { result[$0] }
        if current == next { continue }
        guard current == old, let index else { return nil }
        if let next { result[index] = next } else { result.remove(at: index) }
    }
    for (index, block) in local.enumerated() where !base.contains(where: { $0.id == block.id }) {
        if let existing = result.first(where: { $0.id == block.id }) {
            if existing != block { return nil }
            continue
        }
        if index == 0 {
            result.insert(block, at: 0)
        } else {
            guard let previous = result.firstIndex(where: { $0.id == local[index - 1].id }) else {
                return nil
            }
            result.insert(block, at: previous + 1)
        }
    }
    let common = Set(base.filter { old in local.contains { $0.id == old.id } }.map(\.id))
    guard
        base.filter({ common.contains($0.id) }).map(\.id)
            == local.filter({ common.contains($0.id) }).map(\.id)
    else { return nil }
    return result
}

@MainActor @Observable final class NoteModel {
    let api: RoostAPI
    let agent: Agent
    var draft: NoteDraft?
    var remote: NoteSnapshot?
    var error: String?
    var busy = false
    var change = 0
    var history: [NoteRevision] = []
    private var refreshing = false
    private var draftURL: URL { WorkspaceDrafts.url(api: api, agent: agent.id, key: "note") }
    private var path: String { "agents/\(agent.id)/note" }
    var canEdit: Bool {
        draft != nil && (draft?.pending == nil || (busy && draft?.pending?.action == ""))
    }
    var dirty: Bool { draft.map { $0.blocks != $0.base.blocks } ?? false }
    var status: String {
        if remote != nil { return "Review shared changes" }
        if busy { return "Saving…" }
        if error != nil || draft?.pending != nil { return "Saved on this iPhone; sync needed" }
        if dirty { return "Saving changes…" }
        return "Shared with \(agent.name)"
    }
    init(agent: Agent, api: RoostAPI) {
        self.agent = agent
        self.api = api
        do { draft = try WorkspaceDrafts.load(NoteDraft.self, from: draftURL) } catch {
            self.error = "Could not restore your note draft. " + error.localizedDescription
        }
    }
    func persist() throws {
        if let draft { try WorkspaceDrafts.save(draft, to: draftURL) }
    }
    func edit(_ blocks: [NoteBlock]) {
        guard canEdit else { return }
        draft?.blocks = blocks
        do {
            try persist()
            change += 1
        } catch { self.error = "Could not save this draft. " + error.localizedDescription }
    }
    func refresh() async {
        guard !refreshing, !busy else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let next: NoteSnapshot = try await api.get(path)
            if let current = draft {
                // A slower read must not roll back a save that completed while it was in flight.
                if current.base.revision >= next.revision {
                    if !dirty && current.pending == nil && remote == nil { error = nil }
                    return
                }
                if current.pending != nil {
                    // A response may have been lost. Preserve the exact request
                    // until the user retries; the server returns its saved receipt.
                    remote = next
                } else if let merged = reconcileNote(
                    base: current.base.blocks, local: current.blocks, remote: next.blocks)
                {
                    draft = NoteDraft(base: next, blocks: merged)
                    remote = nil
                    if dirty { change += 1 }
                } else {
                    remote = next
                }
            } else {
                draft = NoteDraft(base: next, blocks: next.blocks)
            }
            try persist()
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    func save(action: String = "", instructions: String? = nil, restore: Int? = nil) async {
        guard !busy, let current = draft else { return }
        if current.pending == nil && remote != nil { return }
        if current.pending == nil && !dirty && instructions == nil && restore == nil { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            if draft?.pending == nil {
                draft?.pending = PendingNoteWrite(
                    action: action,
                    input: NoteWrite(
                        requestId: UUID().uuidString,
                        revision: current.base.revision,
                        blocks: action.isEmpty ? current.blocks : nil,
                        instructions: instructions, targetRevision: restore))
            }
            try persist()
            let pending = draft!.pending!
            let data = try await api.post(path + pending.action, pending.input)
            let saved = try JSONDecoder().decode(NoteSnapshot.self, from: data)
            let local = draft?.blocks ?? saved.blocks
            draft = NoteDraft(base: saved, blocks: pending.action.isEmpty ? local : saved.blocks)
            remote = nil
            try persist()
            if dirty { change += 1 }
        } catch {
            self.error = error.localizedDescription
            if [400, 409].contains((error as? APIError)?.status ?? 0) {
                draft?.pending = nil
                try? persist()
            }
            if error.localizedDescription.contains("NOTE_CONFLICT:") {
                // Definite rejection: safe to allow reconciliation with a new ID.
                draft?.pending = nil
                do {
                    remote = try await api.get(path)
                    try persist()
                } catch { self.error = error.localizedDescription }
            }
        }
    }
    func resolve(keepLocal: Bool) {
        guard let remote, !busy, draft?.pending == nil else { return }
        let blocks = keepLocal ? draft?.blocks ?? remote.blocks : remote.blocks
        draft = NoteDraft(base: remote, blocks: blocks)
        self.remote = nil
        error = nil
        do {
            try persist()
            change += 1
        } catch { self.error = error.localizedDescription }
    }
    func loadHistory(older: Bool = false) async {
        do {
            let query =
                older
                ? history.last.map { [URLQueryItem(name: "before", value: String($0.revision))] }
                    ?? [] : []
            let rows: [NoteRevision] = try await api.get(path + "/history", query: query)
            history = older ? history + rows : rows
        } catch { self.error = error.localizedDescription }
    }
    func revision(_ number: Int) async throws -> NoteSnapshot {
        try await api.get(path + "/\(number)")
    }
}
