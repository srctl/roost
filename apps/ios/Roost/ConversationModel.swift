import Foundation
import Observation

@MainActor @Observable final class ConversationModel {
    var agent: Agent
    let conversationId: String
    let api: RoostAPI
    let dashboards: ChatDashboardStore
    var entries: [Entry] = []
    var threads: [ReplyThread] = []
    var approvals: [Approval] = []
    var draft = ""
    var attachments: [Attachment] = []
    var pending: SendRequest?
    var error: String?
    private(set) var refreshError: String?
    var busy = false
    var sending = false
    private(set) var stopping = false
    private(set) var deliveryUnconfirmed = false
    var loading = true
    var uploading = false
    var status: String?
    var runId: String?
    var before: Int?
    private var revision: Int?
    private var refreshing = false
    private(set) var loadingOlder = false
    private var acceptedOutgoing: [Message] = []
    private(set) var arrivingMessageIDs: Set<String> = []
    private(set) var isSessionActive = true
    @ObservationIgnored private let sendMessage: @MainActor (SendRequest) async throws -> Void

    var hasDraft: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
    }

    var messageLength: Int { draft.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count }
    var hasComposerContent: Bool { hasDraft }
    var showsStop: Bool { busy && !hasDraft && pending == nil && !uploading }

    var canSend: Bool {
        isSessionActive && !sending && !uploading
            && (pending != nil || (hasDraft && messageLength <= 32_000))
    }

    var outgoingMessage: Message? {
        guard let pending else { return nil }
        return Message(
            id: pending.messageId, role: "user", text: pending.text,
            title: nil, status: nil, details: nil,
            files: attachments.filter { pending.attachmentIds.contains($0.id) }, createdAt: nil
        )
    }

    var displayedEntries: [Entry] {
        let local = acceptedOutgoing + (outgoingMessage.map { [$0] } ?? [])
        let knownIDs = Set(entries.map(\.id))
        return entries
            + local.filter { !knownIDs.contains($0.id) }.enumerated()
            .map { index, message in
                Entry(position: (entries.last?.position ?? 0) + index + 1, message: message)
            }
    }

    init(
        agent: Agent, conversationId: String, api: RoostAPI,
        sendMessage: (@MainActor (SendRequest) async throws -> Void)? = nil,
        dashboards: ChatDashboardStore? = nil
    ) {
        self.agent = agent
        self.conversationId = conversationId
        self.api = api
        self.dashboards = dashboards ?? ChatDashboardStore(api: api, agentId: agent.id)
        self.sendMessage =
            sendMessage ?? { input in
                _ = try await api.post("agents/\(agent.id)/messages", input)
            }
        do {
            if let saved = try Drafts.load(
                server: api.connection.server, agent: agent.id, conversation: conversationId)
            {
                draft = saved.text
                attachments = saved.attachments
                pending = saved.pending
                deliveryUnconfirmed = saved.pending != nil
            }
        } catch { self.error = "Could not restore this draft. " + error.localizedDescription }
    }

    func saveDraft() throws {
        guard isSessionActive else { throw CancellationError() }
        try Drafts.save(
            SavedDraft(text: draft, attachments: attachments, pending: pending),
            server: api.connection.server, agent: agent.id, conversation: conversationId)
    }

    func persistDraft() {
        guard isSessionActive else { return }
        do { try saveDraft() } catch {
            self.error = "Could not save your draft. " + error.localizedDescription
        }
    }
    var path: String { "agents/\(agent.id)/" }

    // Views and in-flight requests can retain a model after a connection change.
    // Retire it before clearing the cache so late work cannot restore old drafts.
    func invalidateSession() {
        isSessionActive = false
        approvals = []
        sending = false
        uploading = false
        stopping = false
        refreshing = false
        loadingOlder = false
        loading = false
    }

    func merge(_ incoming: [Entry]) {
        guard isSessionActive else { return }
        if revision != nil {
            let knownIDs = Set(entries.map(\.id))
            let latestPosition = entries.last?.position ?? 0
            arrivingMessageIDs.formUnion(
                incoming.filter {
                    !knownIDs.contains($0.id) && $0.position > latestPosition
                        && $0.message.role != "user"
                }
                .map(\.id))
        }
        var map = Dictionary(entries.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        for entry in incoming { map[entry.id] = entry }
        entries = map.values.sorted { $0.position < $1.position }
        let receivedIDs = Set(incoming.map(\.id))
        acceptedOutgoing.removeAll { receivedIDs.contains($0.id) }
        if let pending,
            incoming.contains(where: { $0.id == pending.messageId && $0.message.role == "user" })
        {
            acknowledge(pending)
        }
        // Historical rows do not need to keep entrance-animation state forever.
        arrivingMessageIDs.formIntersection(Set(entries.suffix(100).map(\.id)))
    }

    private func acknowledge(_ input: SendRequest) {
        guard isSessionActive, pending?.messageId == input.messageId else { return }
        pending = nil
        deliveryUnconfirmed = false
        if draft.trimmingCharacters(in: .whitespacesAndNewlines) == input.text { draft = "" }
        attachments.removeAll { input.attachmentIds.contains($0.id) }
        error = nil
        persistDraft()
    }

    func refresh() async {
        guard isSessionActive, !refreshing else { return }
        refreshing = true
        defer {
            refreshing = false
            loading = false
        }
        do {
            var query = [URLQueryItem(name: "conversationId", value: conversationId)]
            if let revision { query.append(URLQueryItem(name: "since", value: String(revision))) }
            let snapshot: Snapshot = try await api.get(path + "conversation", query: query)
            try Task.checkCancellation()
            guard isSessionActive else { return }
            merge(snapshot.entries)
            if revision == nil { before = snapshot.before }
            revision = snapshot.revision
            threads = snapshot.threads
            busy = snapshot.busy
            runId = snapshot.runId
            status = snapshot.status
            self.approvals = self.approvals.filter { $0.runId == snapshot.runId }
            let approvals: [Approval] = try await api.get(path + "approvals")
            try Task.checkCancellation()
            guard isSessionActive else { return }
            self.approvals = approvals.filter { $0.runId == snapshot.runId }
            refreshError = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {} catch { if isSessionActive { refreshError = error.localizedDescription } }
    }

    func loadOlder() async {
        guard isSessionActive, let before, !loadingOlder else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page: Snapshot = try await api.get(
                path + "conversation",
                query: [
                    URLQueryItem(name: "conversationId", value: conversationId),
                    URLQueryItem(name: "before", value: String(before)),
                ])
            try Task.checkCancellation()
            guard isSessionActive else { return }
            merge(page.entries)
            self.before = page.before
        } catch is CancellationError {} catch {
            if isSessionActive { self.error = error.localizedDescription }
        }
    }

    func prepareSend() throws -> SendRequest? {
        guard isSessionActive else { throw CancellationError() }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard pending != nil || !text.isEmpty || !attachments.isEmpty else { return nil }
        guard pending != nil || messageLength <= 32_000 else {
            throw APIError(message: "Keep your message under 32,000 characters.")
        }
        // Keep the exact payload and UUID after ambiguous network failure. A
        // retry cannot enqueue a duplicate turn or change an accepted request.
        let input =
            pending
            ?? SendRequest(
                messageId: UUID().uuidString, conversationId: conversationId, text: text,
                attachmentIds: attachments.map(\.id))
        let previous = pending
        pending = input
        do {
            try saveDraft()
            if previous == nil { deliveryUnconfirmed = false }
            return input
        } catch {
            pending = previous
            throw error
        }
    }

    func send() async {
        guard isSessionActive, !sending else { return }
        sending = true
        defer { sending = false }
        let wasUnconfirmed = deliveryUnconfirmed
        var attempted: SendRequest?
        do {
            guard let input = try prepareSend() else { return }
            attempted = input
            let outgoing = outgoingMessage
            try await sendMessage(input)
            guard isSessionActive else { return }
            if let outgoing, !entries.contains(where: { $0.id == outgoing.id }) {
                acceptedOutgoing.append(outgoing)
            }
            acknowledge(input)
            await refresh()
        } catch {
            guard isSessionActive else { return }
            // A receipt may have arrived through polling while POST was still
            // waiting. A late transport failure must not resurrect that send.
            if let attempted, entries.contains(where: { $0.id == attempted.messageId }) { return }
            let failure = error
            if let failure = failure as? APIError, failure.rejectsMessage, !wasUnconfirmed {
                pending = nil
                deliveryUnconfirmed = false
                do { try saveDraft() } catch {
                    self.error =
                        failure.localizedDescription + " Could not save your draft. "
                        + error.localizedDescription
                    return
                }
            } else {
                deliveryUnconfirmed = pending != nil
            }
            self.error = failure.localizedDescription
        }
    }

    func stop() async {
        guard isSessionActive, let runId, !stopping else { return }
        stopping = true
        defer { stopping = false }
        do {
            _ = try await api.post(path + "stop", ["id": runId])
            guard isSessionActive else { return }
            error = nil
            await refresh()
        } catch { if isSessionActive { self.error = error.localizedDescription } }
    }

    func reply(to message: Message) async -> String? {
        guard isSessionActive, message.role == "assistant", conversationId == agent.id else {
            return nil
        }
        do {
            let data = try await api.post(path + "threads", ["parentMessageId": message.id])
            guard isSessionActive else { return nil }
            let response = try JSONDecoder().decode(IDResponse.self, from: data)
            await refresh()
            guard isSessionActive else { return nil }
            return response.id
        } catch {
            if isSessionActive { self.error = error.localizedDescription }
            return nil
        }
    }

    func answer(_ approval: Approval, decision: String, answers: [String: String]) async throws {
        guard isSessionActive else { throw CancellationError() }
        guard approval.runId == runId, approvals.contains(where: { $0.id == approval.id }) else {
            throw APIError(
                message:
                    "This approval is no longer waiting in this conversation. Refresh to continue.")
        }

        struct Response: Encodable {
            let decision: String
            let answers: [String: String]?
        }

        struct Input: Encodable {
            let id: String
            let response: Response
        }
        _ = try await api.post(
            path + "approvals",
            Input(
                id: approval.id,
                response: Response(
                    decision: decision, answers: decision == "answer" ? answers : nil)))
        guard isSessionActive else { throw CancellationError() }
        approvals.removeAll { $0.id == approval.id }
        await refresh()
    }
}
@MainActor @Observable final class AppModel {
    var connection: Connection? {
        didSet {
            if oldValue != connection {
                connectionChangeID = UUID()
                retireConversations()
                agents = []
            }
        }
    }
    private(set) var sessionID = UUID()
    var agents: [Agent] = [] {
        didSet {
            for conversation in conversations.values {
                if let agent = agents.first(where: { $0.id == conversation.agent.id }),
                    conversation.agent != agent
                {
                    conversation.agent = agent
                }
            }
        }
    }
    var error: String?
    var loading = false
    // Cache lookup happens while SwiftUI builds destinations. Updating observable
    // state here would recursively invalidate that same view graph.
    @ObservationIgnored private var conversations: [String: ConversationModel] = [:]
    @ObservationIgnored private var connectionChangeID = UUID()
    @ObservationIgnored private var chatDashboards: [String: ChatDashboardStore] = [:]
    private let session: URLSession?

    private func retireConversations() {
        for conversation in conversations.values { conversation.invalidateSession() }
        conversations = [:]
        for store in chatDashboards.values { store.invalidate() }
        chatDashboards = [:]
        sessionID = UUID()
        loading = false
    }

    init(session: URLSession? = nil) {
        self.session = session
        Drafts.clearPreviews()
        #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-ui-testing-reset") {
                try? SecureConnection.clear()
                try? Drafts.clear()
                UserDefaults.standard.removeObject(forKey: "responseStyle")
                UserDefaults.standard.removeObject(forKey: "themePreset")
                UserDefaults.standard.removeObject(forKey: "appearance")
                UserDefaults.standard.removeObject(forKey: "showActivityDetails")
            }
        #endif
        do { connection = try SecureConnection.load() } catch {
            self.error = error.localizedDescription
        }
    }
    var api: RoostAPI? { connection.map { RoostAPI(connection: $0, session: session) } }

    func conversation(agent: Agent, id: String? = nil) -> ConversationModel? {
        guard let api else { return nil }
        let id = id ?? agent.id
        let key = agent.id + ":" + id
        if let existing = conversations[key] {
            return existing
        }
        let dashboards = chatDashboards[agent.id] ?? ChatDashboardStore(api: api, agentId: agent.id)
        chatDashboards[agent.id] = dashboards
        let model = ConversationModel(
            agent: agent, conversationId: id, api: api, dashboards: dashboards)
        conversations[key] = model
        return model
    }

    func connect(server: String, token: String) async throws {
        try Task.checkCancellation()
        let changeID = UUID()
        connectionChangeID = changeID
        let connection = try Connection.make(server: server, token: token)
        let api = RoostAPI(connection: connection, session: self.session)
        let session: SessionResponse = try await api.get("session")
        guard session.apiVersion == 1 else {
            throw APIError(message: "Update the app to connect to this server.")
        }
        let agents: [Agent] = try await api.get("agents")
        try Task.checkCancellation()
        guard connectionChangeID == changeID else { throw CancellationError() }
        for model in conversations.values { try model.saveDraft() }
        try SecureConnection.save(connection)
        ImageThumbnailStore.shared.clear()
        if self.connection == connection { retireConversations() }
        self.connection = connection
        self.agents = agents
        error = nil
    }

    func refresh() async {
        guard let api, !loading else { return }
        let session = sessionID
        loading = true
        defer { if sessionID == session { loading = false } }
        do {
            let agents: [Agent] = try await api.get("agents")
            guard sessionID == session else { return }
            self.agents = agents
            error = nil
        } catch is CancellationError {} catch let failure as URLError
            where failure.code == .cancelled
        {} catch { if sessionID == session { self.error = error.localizedDescription } }
    }

    func disconnect(revoke: Bool) async throws {
        let changeID = UUID()
        connectionChangeID = changeID
        if revoke, let api { _ = try await api.request("session", method: "DELETE") }
        guard connectionChangeID == changeID else { throw CancellationError() }
        try Drafts.clear()
        Drafts.clearPreviews()
        try SecureConnection.clear()
        ImageThumbnailStore.shared.clear()
        connection = nil
        agents = []
        error = nil
    }
}
