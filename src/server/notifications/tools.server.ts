import { randomUUID } from "node:crypto";
import { Effect, JSONSchema, Schema } from "effect";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import type { JsonValue } from "../codex/protocol/serde_json/JsonValue";
import type { DynamicToolSpec } from "../codex/protocol/v2/DynamicToolSpec";
import { runConversationId } from "../runs/threads.server";
import { putMessage } from "../runs/timeline.server";
import { writeTransaction } from "../transaction.server";
import { deliverAttention } from "./push.server";

export const NotifyAgent = Schema.Struct({
  requestId: Schema.UUID,
  title: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(100)),
  body: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(240)),
});

export const notificationTools: DynamicToolSpec[] = [
  {
    type: "function",
    name: "roost_notify",
    description:
      "Send this agent's useful update to the user when requested by their task, including from an automation. For example, after verifying a package was delivered, name the package and the delivery details. Supply a concise title and body with the actual outcome and useful specifics, not generic completion text or progress spam. Never include secrets. Use a stable requestId UUID for the same event across retries; changing its content is rejected. The update is always saved in this conversation; device notifications respect the user's Settings, which only the user can change. The result reports push-provider submissions, not guaranteed device display. This tool sends now; it does not schedule or monitor future events. Delegated tasks must report back to their originating agent instead.",
    inputSchema: JSONSchema.make(NotifyAgent) as unknown as JsonValue,
  },
];

export const notifyAgent = (
  agentId: string,
  runId: string | undefined,
  input: typeof NotifyAgent.Type,
  options: Parameters<typeof deliverAttention>[1] = {},
) =>
  Effect.gen(function* () {
    const data = yield* Schema.decodeUnknown(NotifyAgent)(input);
    const record = yield* withAgentStore(
      (db) =>
        writeTransaction(db, () => {
          requireAgent(db, agentId);
          const source = runId
            ? db
                .prepare(
                  "SELECT kind,status,cancelRequested FROM runs WHERE id=? AND agentId=?",
                )
                .get(runId, agentId)
            : undefined;
          if (source?.status !== "running" || source.cancelRequested !== 0)
            throw new AgentStoreError({
              message:
                "Notifications require an active, uncancelled run for this agent.",
            });
          if (source.kind === "delegation")
            throw new AgentStoreError({
              message:
                "Report delegated task updates to the originating agent; Roost delivers your result automatically.",
            });
          const existing = db
            .prepare(
              "SELECT id,title,body FROM agent_notifications WHERE agentId=? AND requestId=?",
            )
            .get(agentId, data.requestId);
          if (
            existing &&
            (existing.title !== data.title || existing.body !== data.body)
          )
            throw new AgentStoreError({
              message:
                "This request ID has already been used for a different notification. Reuse the original content for a retry.",
            });
          db.prepare(
            "UPDATE runs SET hasAgentUpdate=1 WHERE id=? AND agentId=?",
          ).run(runId!, agentId);
          const id = existing ? String(existing.id) : randomUUID();
          if (!existing) {
            db.prepare(
              "INSERT INTO agent_notifications (id,agentId,runId,requestId,title,body,createdAt) VALUES (?,?,?,?,?,?,?)",
            ).run(
              id,
              agentId,
              runId!,
              data.requestId,
              data.title,
              data.body,
              Date.now(),
            );
            putMessage(
              db,
              agentId,
              {
                id: `notification:${id}`,
                role: "notice",
                title: data.title,
                text: data.body,
              },
              runConversationId(db, agentId, runId!),
            );
          }
          return { id, recorded: true, duplicate: !!existing };
        }),
      options.directory,
    );

    // Claim the event before delivery so a retry can never submit it twice.
    // Failed or disabled push delivery still leaves the readable update saved.
    if (record.duplicate)
      return {
        ...record,
        delivery: {
          status: "already-recorded",
          message: "This update was already saved. No new push was submitted.",
        },
      };

    const delivery = yield* Effect.tryPromise(() =>
      deliverAttention(
        {
          agentId,
          id: record.id,
          kind: "agent",
          title: data.title,
          body: data.body,
        },
        options,
      ),
    ).pipe(
      Effect.match({
        onSuccess: (result) => ({
          ...result,
          status: result.delivered
            ? "submitted"
            : result.failed
              ? "failed"
              : "not-submitted",
          message: result.delivered
            ? "Accepted by the push provider for the reported devices; display is not guaranteed."
            : "No push was accepted. Notifications may be off, unavailable, or have no active devices. The update is saved in the conversation.",
        }),
        onFailure: () => ({
          status: "failed",
          message:
            "Push submission failed. The update is saved in the conversation.",
        }),
      }),
    );
    return { ...record, delivery };
  });
