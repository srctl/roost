import type { DatabaseSync } from "node:sqlite";
import {
  isReactionEmoji,
  MAX_REACTIONS_PER_ACTOR,
} from "../../features/chat/reactions";
import type {
  Message,
  MessageReaction,
  SetReaction,
} from "../../features/chat/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { writeTransaction } from "../transaction.server";
import { requireConversation } from "./threads.server";
import { refreshParentMessage } from "./timeline.server";

// Call inside a write transaction so callers can check runtime state and
// mutate the message under the same lock.
export function updateMessageReaction(
  db: DatabaseSync,
  input: SetReaction,
  actor: MessageReaction["actor"],
): Message {
  const conversationId = input.conversationId ?? input.agentId;
  requireConversation(db, input.agentId, conversationId);
  if (!isReactionEmoji(input.emoji))
    throw new AgentStoreError({ message: "Choose a single emoji." });
  const row = db
    .prepare(
      "SELECT message,createdAt FROM timeline WHERE agentId=? AND conversationId=? AND id=?",
    )
    .get(input.agentId, conversationId, input.messageId);
  if (!row) throw new AgentStoreError({ message: "Message not found." });
  const message = JSON.parse(String(row.message)) as Message;
  if (
    (message.role !== "user" && message.role !== "assistant") ||
    (actor === "user" && message.role !== "assistant")
  )
    throw new AgentStoreError({
      message:
        actor === "user"
          ? "You can react to AI messages."
          : "Only chat messages can receive reactions.",
    });
  const reactions = message.reactions ?? [];
  const hasReaction = reactions.some(
    (reaction) => reaction.emoji === input.emoji && reaction.actor === actor,
  );
  if (
    input.active &&
    !hasReaction &&
    reactions.filter((reaction) => reaction.actor === actor).length >=
      MAX_REACTIONS_PER_ACTOR
  )
    throw new AgentStoreError({
      message: `Use up to ${MAX_REACTIONS_PER_ACTOR} reactions per message.`,
    });
  const updated: Message =
    hasReaction === input.active
      ? message
      : {
          ...message,
          reactions: input.active
            ? [...reactions, { emoji: input.emoji, actor }]
            : reactions.filter(
                (reaction) =>
                  reaction.emoji !== input.emoji || reaction.actor !== actor,
              ),
        };
  if (updated !== message) {
    // Updating the JSON uses the existing timeline revision trigger, so
    // paged clients receive reaction edits even for older messages.
    db.prepare(
      "UPDATE timeline SET message=? WHERE agentId=? AND conversationId=? AND id=?",
    ).run(
      JSON.stringify(updated),
      input.agentId,
      conversationId,
      input.messageId,
    );
    refreshParentMessage(db, input.agentId, conversationId, input.messageId);
  }
  return {
    ...updated,
    ...(Number(row.createdAt) > 0 ? { createdAt: Number(row.createdAt) } : {}),
  };
}

// Actor identity is supplied by the trusted server function or agent runtime,
// never a browser/model argument. Explicit active state makes retries harmless.
export const setMessageReaction = (
  input: SetReaction,
  actor: MessageReaction["actor"],
  directory?: string,
) =>
  withAgentStore(
    (db) => writeTransaction(db, () => updateMessageReaction(db, input, actor)),
    directory,
  );
