import { useEffect, useRef, useState } from "react";
import { getConversation, sendMessage, stopMessage } from "./functions";
import type { Message } from "./schema";

export function useConversation(
  agentId: string,
  initialMessages: readonly Message[],
) {
  const [messages, setMessages] = useState<readonly Message[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const runId = useRef<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  async function reload() {
    const version = ++generation.current;
    try {
      const result = await getConversation({ data: agentId });
      if (!mounted.current || version !== generation.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (submitting.current) return;
      setError(undefined);
      setMessages(result.value.messages);
      setBusy(result.value.busy);
      runId.current = result.value.runId;
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
  async function send(text: string) {
    if (submitting.current || busy || !text.trim()) return;
    generation.current++;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    const messageId = crypto.randomUUID();
    setMessages((messages) => [
      ...messages,
      { id: messageId, role: "user", text },
    ]);
    try {
      const result = await sendMessage({ data: { agentId, messageId, text } });
      if (!result.ok) throw new Error(result.error);
      runId.current = result.value.id;
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
    if (!runId.current) return;
    const result = await stopMessage({
      data: { agentId, id: runId.current },
    }).catch(() => null);
    if (!result?.ok) setError("Could not stop the run. Try again.");
    else await reload();
  }
  return { messages, busy, error, send, stop, reload };
}
