import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileAttachment } from "./files";
import {
  getConversation,
  type InitialConversation,
  sendMessage,
  setReaction,
  stopMessage,
} from "./functions";
import type { Message } from "./schema";
import { type Entry, mergeEntries } from "./timeline";

type PendingReaction = { emoji: string; active: boolean };

function withPendingReaction(
  message: Message,
  pending: PendingReaction | undefined,
): Message {
  if (!pending) return message;
  const reactions = (message.reactions ?? []).filter(
    (reaction) => reaction.actor !== "user" || reaction.emoji !== pending.emoji,
  );
  if (pending.active) reactions.push({ actor: "user", emoji: pending.emoji });
  return { ...message, reactions };
}

export function useConversation(
  agentId: string,
  initialConversation?: InitialConversation,
  conversationId = agentId,
) {
  const initial = initialConversation?.ok
    ? initialConversation.value
    : undefined;
  const ready = !!initial && !initial.needsImport;
  const [threads, setThreads] = useState(initial?.threads ?? []);
  const [runStatus, setRunStatus] = useState(initial?.status ?? null);
  const [active, setActive] = useState(initial?.active);
  const [entries, setEntries] = useState<readonly Entry[]>(
    initial?.entries ?? [],
  );
  const [pendingReactions, setPendingReactions] = useState<
    Record<string, PendingReaction>
  >({});
  const reacting = useRef(new Set<string>());
  const messages = useMemo(
    () =>
      entries.map((entry) =>
        withPendingReaction(
          entry.message,
          pendingReactions[`${conversationId}:${entry.message.id}`],
        ),
      ),
    [conversationId, entries, pendingReactions],
  );
  const visibleThreads = useMemo(
    () =>
      threads.map((thread) => ({
        ...thread,
        parent: withPendingReaction(
          thread.parent,
          pendingReactions[`${agentId}:${thread.parent.id}`],
        ),
      })),
    [agentId, threads, pendingReactions],
  );
  const [loading, setLoading] = useState(!ready);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [before, setBefore] = useState<number | null>(initial?.before ?? null);
  const cursor = useRef<number | undefined>(
    ready ? initial.revision : undefined,
  );
  const paging = useRef(false);
  const [computerAnchor, setComputerAnchor] = useState<string | null>(
    initial?.computerAnchor ?? null,
  );
  const [busy, setBusy] = useState(initial?.busy ?? false);
  const [error, setError] = useState<string | undefined>(
    initialConversation && !initialConversation.ok
      ? initialConversation.error
      : undefined,
  );
  const [runId, setRunId] = useState<string | null>(initial?.runId ?? null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const version = ++generation.current;
    try {
      const result = await getConversation({
        data: { agentId, conversationId, since: cursor.current },
      });
      if (!mounted.current || version !== generation.current) return;
      if (!result.ok) {
        setError(result.error);

        return;
      }
      if (submitting.current) return;
      setError(undefined);
      const firstPage = cursor.current === undefined;
      if (firstPage) setBefore(result.value.before);
      cursor.current = result.value.revision;
      setEntries((current) =>
        firstPage
          ? result.value.entries
          : mergeEntries(
              current,
              result.value.entries.filter(
                (entry) =>
                  !current.length || entry.position >= current[0]!.position,
              ),
            ),
      );
      setLoading(false);
      setBusy(result.value.busy);
      setThreads(result.value.threads);
      setRunStatus(result.value.status);
      setActive(result.value.active);
      setComputerAnchor(result.value.computerAnchor);
      setRunId(result.value.runId);
    } catch {
      if (mounted.current && version === generation.current)
        setError("Disconnected from Roost. Your run continues on the server.");
    }
  }, [agentId, conversationId]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      await reload();
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    };

    void poll();

    return () => {
      cancelled = true;
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [reload]);

  async function loadOlder() {
    if (before === null || paging.current) return;
    paging.current = true;
    setLoadingOlder(true);
    const revision = cursor.current;
    try {
      const result = await getConversation({
        data: { agentId, conversationId, before },
      });
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.error);

        return;
      }
      setEntries((current) => mergeEntries(result.value.entries, current));
      setBefore(result.value.before);
      // Replay changes made while the older page was in flight.
      generation.current++;
      cursor.current =
        revision === undefined || cursor.current === undefined
          ? undefined
          : Math.min(revision, cursor.current);
    } catch {
      if (mounted.current)
        setError("Could not load older messages. Try again.");
    } finally {
      paging.current = false;
      if (mounted.current) setLoadingOlder(false);
    }
  }

  async function send(text: string, files: readonly FileAttachment[] = []) {
    if (submitting.current || loading || (!text.trim() && !files.length))
      return false;
    generation.current++;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    const signature = JSON.stringify({
      text,
      files: files.map((file) => file.id),
    });
    const pendingKey = `roost:pending:${conversationId}`;
    let pending: { id: string; signature: string } | undefined;
    try {
      pending = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
    } catch {}
    const messageId =
      pending?.signature === signature ? pending.id : crypto.randomUUID();
    sessionStorage.setItem(
      pendingKey,
      JSON.stringify({ id: messageId, signature }),
    );
    if (!busy) setRunId(messageId);
    setEntries((entries) => [
      ...entries,
      {
        position: (entries.at(-1)?.position ?? 0) + 0.5,
        message: {
          id: messageId,
          role: "user",
          text,
          ...(files.length ? { files } : {}),
        },
      },
    ]);
    try {
      const result = await sendMessage({
        data: {
          agentId,
          conversationId,
          messageId,
          text,
          attachmentIds: files.map((file) => file.id),
        },
      });
      if (!result.ok) throw new Error(result.error);
      setRunId(result.value.id);
      sessionStorage.removeItem(pendingKey);
      return true;
    } catch {
      if (mounted.current)
        setError(
          "Couldn't confirm the send. Check the conversation before resending.",
        );
      return false;
    } finally {
      submitting.current = false;
      if (mounted.current) await reload();
    }
  }

  async function react(
    messageId: string,
    emoji: string,
    active: boolean,
    targetConversationId = conversationId,
  ) {
    const key = `${targetConversationId}:${messageId}`;
    if (reacting.current.has(key)) return;
    reacting.current.add(key);
    const revision = cursor.current;
    setPendingReactions((current) => ({
      ...current,
      [key]: { emoji, active },
    }));
    try {
      const result = await setReaction({
        data: {
          agentId,
          conversationId: targetConversationId,
          messageId,
          emoji,
          active,
        },
      });
      if (!result.ok) throw new Error(result.error);
      if (!mounted.current) return;
      // Preserve concurrently streamed content and other reactions. Replay
      // changes since this request began, even if a newer poll already landed.
      generation.current++;
      cursor.current =
        revision === undefined || cursor.current === undefined
          ? undefined
          : Math.min(revision, cursor.current);
      const update = (message: Message) =>
        message.id === messageId
          ? withPendingReaction(message, { emoji, active })
          : message;
      if (targetConversationId === conversationId) {
        setEntries((current) =>
          current.map((entry) => ({
            ...entry,
            message: update(entry.message),
          })),
        );
      }
      if (targetConversationId === agentId) {
        setThreads((current) =>
          current.map((thread) => ({
            ...thread,
            parent: update(thread.parent),
          })),
        );
      }
    } finally {
      reacting.current.delete(key);
      if (mounted.current)
        setPendingReactions((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
    }
  }

  async function stop() {
    if (!runId) return;
    const result = await stopMessage({
      data: { agentId, id: runId },
    }).catch(() => null);
    if (!result?.ok) setError("Could not stop the run. Try again.");
    else await reload();
  }

  return {
    threads: visibleThreads,
    runStatus,
    active,
    messages,
    computerAnchor,
    busy,
    runId,
    error,
    send,
    react,
    stop,
    reload,
    loading,
    loadingOlder,
    before,
    loadOlder,
  };
}
