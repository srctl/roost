import type { Message } from "../chat/schema";

// Only the current run can open a preview; saved history is never live.
export function computerPreviewAnchor(
  messages: readonly Message[],
  runId: string | null,
) {
  if (!runId) return;
  const start = messages.findIndex(
    (message) => message.role === "user" && message.id === runId,
  );
  if (start === -1) return;
  for (const message of messages.slice(start + 1)) {
    if (message.role === "user") return;
    if (message.role === "activity" && message.title === "roost_computer") {
      return message.id;
    }
  }
}
