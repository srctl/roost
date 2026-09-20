import { Effect, JSONSchema, Schema } from "effect";
import type { Message } from "../../features/chat/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import type { JsonValue } from "../codex/protocol/serde_json/JsonValue";
import type { DynamicToolSpec } from "../codex/protocol/v2/DynamicToolSpec";
import { writeTransaction } from "../transaction.server";
import { updateMessageReaction } from "./reactions.server";
import { requireConversation, runConversationId } from "./threads.server";

export const ReactToMessage = Schema.Struct({
  messageId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
  conversationId: Schema.optional(Schema.UUID),
  emoji: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(64)),
  active: Schema.Boolean,
});

export const reactionTools: DynamicToolSpec[] = [
  {
    type: "function",
    name: "roost_react_to_message",
    description:
      "Add (active=true) or remove (active=false) your emoji reaction to a saved user or assistant message. Use one Unicode emoji, including optional skin tone or joined emoji. Use the current user message ID from Roost conversation context, or retrieve exact message IDs and existing reactions with roost_read_conversations; never guess IDs. conversationId defaults to the current conversation. Repeating the same operation is safe. React sparingly when an acknowledgement or emotional response is helpful; reactions do not replace a substantive answer when one is needed. You can change only your own reactions, never the user's.",
    inputSchema: JSONSchema.make(ReactToMessage) as unknown as JsonValue,
  },
];

export const reactToMessage = (
  agentId: string,
  runId: string | undefined,
  input: typeof ReactToMessage.Type,
) =>
  Effect.gen(function* () {
    const data = yield* Schema.decodeUnknown(ReactToMessage)(input);
    return yield* withAgentStore((db) =>
      writeTransaction(db, () => {
        const source = runId
          ? db
              .prepare(
                "SELECT status,cancelRequested FROM runs WHERE id=? AND agentId=?",
              )
              .get(runId, agentId)
          : undefined;
        if (source?.status !== "running" || source.cancelRequested !== 0)
          throw new AgentStoreError({
            message:
              "Reactions require an active, uncancelled run for this agent.",
          });
        const conversationId =
          data.conversationId ?? runConversationId(db, agentId, runId!);
        return updateMessageReaction(
          db,
          { ...data, agentId, conversationId },
          "assistant",
        );
      }),
    );
  });

// Provider messages do not carry Roost IDs or user reactions. Refresh a small
// snapshot before each chat so the agent can target a message and see feedback.
export const readReactionContext = (
  agentId: string,
  conversationId = agentId,
) =>
  withAgentStore((db) => {
    requireConversation(db, agentId, conversationId);
    return db
      .prepare(
        "SELECT id,message FROM timeline WHERE agentId=? AND conversationId=? AND json_extract(message,'$.role') IN ('user','assistant') ORDER BY position DESC LIMIT 12",
      )
      .all(agentId, conversationId)
      .reverse()
      .map((row) => {
        const message = JSON.parse(String(row.message)) as Message;
        return {
          messageId: String(row.id),
          author: message.role,
          text: message.text.slice(0, 500),
          reactions: message.reactions ?? [],
        };
      });
  });
