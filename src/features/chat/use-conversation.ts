import { useEffect, useMemo, useRef, useState } from "react";
import { getConversation, sendMessage, stopMessage } from "./functions";
import { mergeEntries, type Entry } from "./timeline";

export function useConversation(agentId: string) {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const messages = useMemo(
    () => entries.map((entry) => entry.message),
    [entries],
  );
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const cursor = useRef<number | undefined>(undefined);
  const paging = useRef(false);
  const [computerAnchor, setComputerAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [runId, setRunId] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);

  async function reload() {
    const version = ++generation.current;
    try {
      const result = await getConversation({
        data: { agentId, since: cursor.current },
      });
      if (!mounted.current || version !== generation.current) return;
      if (!result.ok) {
        setError(result.error);

        return;
      }
      if (submitting.current) return;
      setError(undefined);
      if (cursor.current === undefined) setBefore(result.value.before);
      cursor.current = result.value.revision;
      setEntries((current) =>
        mergeEntries(
          current,
          result.value.entries.filter(
            (entry) =>
              !current.length || entry.position >= current[0]!.position,
          ),
        ),
      );
      setLoading(false);
      setBusy(result.value.busy);
      setComputerAnchor(result.value.computerAnchor);
      setRunId(result.value.runId);
    } catch {
      if (mounted.current && version === generation.current)
        setError("Disconnected from Roost. Your run continues on the server.");
    }
  }

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
  }, [agentId]);

  async function loadOlder() {
    if (before === null || paging.current) return;
    paging.current = true;
    setLoadingOlder(true);
    const revision = cursor.current;
    try {
      const result = await getConversation({ data: { agentId, before } });
      if (!mounted.current) return;
      if (!result.ok) {
        setError(result.error);

        return;
      }
      setEntries((current) => mergeEntries(result.value.entries, current));
      setBefore(result.value.before);
      // Replay changes made while the older page was in flight.
      generation.current++;
      cursor.current = revision;
    } catch {
      if (mounted.current)
        setError("Could not load older messages. Try again.");
    } finally {
      paging.current = false;
      if (mounted.current) setLoadingOlder(false);
    }
  }

  async function send(text: string) {
    if (submitting.current || loading || busy || !text.trim()) return;
    generation.current++;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    const messageId = crypto.randomUUID();
    setRunId(messageId);
    setEntries((entries) => [
      ...entries,
      {
        position: (entries.at(-1)?.position ?? 0) + 0.5,
        message: { id: messageId, role: "user", text },
      },
    ]);
    try {
      const result = await sendMessage({ data: { agentId, messageId, text } });
      if (!result.ok) throw new Error(result.error);
      setRunId(result.value.id);
    } catch {
      if (mounted.current)
        setError(
          "Couldn't confirm the send. Check the conversation before resending.",
        );
    } finally {
      submitting.current = false;
      if (mounted.current) await reload();
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
    messages,
    computerAnchor,
    busy,
    runId,
    error,
    send,
    stop,
    reload,
    loading,
    loadingOlder,
    before,
    loadOlder,
  };
}
