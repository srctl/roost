import type { Message } from "../chat/schema";

// Keep one live preview at the first computer action in the latest turn that uses it.
export function computerPreviewAnchor(messages: readonly Message[]) {
  let anchor: string | undefined;
  let firstInTurn = true;
  for (const message of messages) {
    if (message.role === "user") firstInTurn = true;
    if (
      firstInTurn &&
      message.role === "activity" &&
      message.title === "roost_computer"
    ) {
      anchor = message.id;
      firstInTurn = false;
    }
  }
  return anchor;
}
