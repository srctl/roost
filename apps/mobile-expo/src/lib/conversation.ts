import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  APIError,
  type Approval,
  type Entry,
  type Message,
  type ReplyThread,
  type RoostAPI,
  type SendRequest,
  type Snapshot,
} from "./api";

function uuid() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

// Port of ConversationModel.swift: revision-based polling (1s while busy,
// 4s idle, 8s after an error), idempotent sends keyed by message UUID, and
// pending payload reuse after an ambiguous network failure.
export function useConversation(
  api: RoostAPI,
  agentId: string,
  conversationId: string,
) {
  const path = `agents/${agentId}/`;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [threads, setThreads] = useState<ReplyThread[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<SendRequest | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const revision = useRef<number | null>(null);
  const refreshing = useRef(false);
  const accepted = useRef<Message[]>([]);

  const merge = useCallback((incoming: Entry[]) => {
    setEntries((current) => {
      if (revision.current !== null) {
        const known = new Set(current.map((e) => e.message.id));
        const latest = current.at(-1)?.position ?? 0;
        const fresh = incoming.filter(
          (e) =>
            !known.has(e.message.id) &&
            e.position > latest &&
            e.message.role !== "user",
        );
        if (fresh.length)
          setArriving((ids) => {
            const next = new Set(ids);
            for (const e of fresh) next.add(e.message.id);
            return next;
          });
      }
      const map = new Map(current.map((e) => [e.message.id, e]));
      for (const e of incoming) map.set(e.message.id, e);
      const received = new Set(incoming.map((e) => e.message.id));
      accepted.current = accepted.current.filter((m) => !received.has(m.id));
      return [...map.values()].sort((a, b) => a.position - b.position);
    });
    setPending((current) =>
      current &&
      incoming.some(
        (e) => e.message.id === current.messageId && e.message.role === "user",
      )
        ? null
        : current,
    );
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const query: Record<string, string> = { conversationId };
      if (revision.current !== null) query.since = String(revision.current);
      const snapshot = await api.get<Snapshot>(`${path}conversation`, query);
      merge(snapshot.entries);
      revision.current = snapshot.revision;
      setThreads(snapshot.threads);
      setBusy(snapshot.busy);
      setRunId(snapshot.runId);
      setStatus(snapshot.status);
      const list = await api.get<Approval[]>(`${path}approvals`);
      setApprovals(list.filter((a) => a.runId === snapshot.runId));
      setRefreshError(null);
    } catch (failure) {
      setRefreshError((failure as Error).message);
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [api, path, conversationId, merge]);

  // Poll only while the app is foregrounded, like the SwiftUI scenePhase task.
  const cadence = refreshError ? 8000 : busy ? 1000 : 4000;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = AppState.currentState === "active";
    const tick = async () => {
      if (!active) return;
      await refresh();
      timer = setTimeout(tick, cadence);
    };
    tick();
    const subscription = AppState.addEventListener("change", (state) => {
      const next = state === "active";
      if (next && !active) {
        active = true;
        clearTimeout(timer);
        tick();
      } else if (!next) {
        active = false;
        clearTimeout(timer);
      }
    });
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [refresh, cadence]);

  const send = useCallback(async () => {
    if (sending) return;
    const text = draft.trim();
    if (!pending && !text) return;
    if (!pending && text.length > 32_000) {
      setError("Keep your message under 32,000 characters.");
      return;
    }
    const input = pending ?? {
      messageId: uuid(),
      conversationId,
      text,
      attachmentIds: [],
    };
    const retry = pending !== null;
    setPending(input);
    setSending(true);
    try {
      await api.post(`${path}messages`, input);
      accepted.current.push({ id: input.messageId, role: "user", text });
      setPending(null);
      setDraft((current) => (current.trim() === input.text ? "" : current));
      setError(null);
      await refresh();
    } catch (failure) {
      if (failure instanceof APIError && failure.rejectsMessage && !retry) {
        setPending(null);
      }
      setError((failure as Error).message);
    } finally {
      setSending(false);
    }
  }, [api, path, conversationId, draft, pending, sending, refresh]);

  const stop = useCallback(async () => {
    if (!runId || stopping) return;
    setStopping(true);
    try {
      await api.post(`${path}stop`, { id: runId });
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setStopping(false);
    }
  }, [api, path, runId, stopping, refresh]);

  const answer = useCallback(
    async (approval: Approval, decision: string) => {
      await api.post(`${path}approvals`, {
        id: approval.id,
        response: { decision },
      });
      setApprovals((list) => list.filter((a) => a.id !== approval.id));
      await refresh();
    },
    [api, path, refresh],
  );

  const reply = useCallback(
    async (message: Message) => {
      try {
        const { id } = await api.post<{ id: string }>(`${path}threads`, {
          parentMessageId: message.id,
        });
        await refresh();
        return id;
      } catch (failure) {
        setError((failure as Error).message);
        return null;
      }
    },
    [api, path, refresh],
  );

  // Optimistic rows for sent/pending messages the server has not echoed yet.
  const displayed = useMemo(() => {
    const known = new Set(entries.map((e) => e.message.id));
    const local: Message[] = [...accepted.current];
    if (pending)
      local.push({ id: pending.messageId, role: "user", text: pending.text });
    const last = entries.at(-1)?.position ?? 0;
    return [
      ...entries,
      ...local
        .filter((m) => !known.has(m.id))
        .map((message, i) => ({ position: last + i + 1, message })),
    ];
  }, [entries, pending]);

  return {
    entries: displayed,
    threads,
    approvals,
    busy,
    queued: status === "queued",
    loading,
    error: error ?? refreshError,
    clearError: () => setError(null),
    draft,
    setDraft,
    pending,
    sending,
    stopping,
    arriving,
    send,
    stop,
    answer,
    reply,
    refresh,
  };
}
