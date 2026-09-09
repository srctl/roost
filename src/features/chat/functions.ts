import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { withAgentStore } from "../../server/agents/store.server";
import { available } from "../../server/available";
import { isMaintenance } from "../../server/maintenance.server";
import { readConversationSnapshot } from "../../server/runs/conversation-snapshot.server";
import { cancelRun, enqueueChat } from "../../server/runs/store.server";
import { ensureTimeline, startWorker } from "../../server/runs/worker.server";
import { appGate } from "../../updater/gate";
import { SendMessage } from "./schema";

const result = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: () => ({
          ok: false as const,
          error: "Could not access this conversation. Check Roost and retry.",
        }),
      }),
    ),
  );

export const getConversationSnapshot = createServerFn({ method: "GET" })
  .validator(Schema.decodeUnknownSync(Schema.Struct({ agentId: Schema.UUID })))
  .handler(({ data }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    return result(readConversationSnapshot(data.agentId));
  });

export type InitialConversation = Awaited<
  ReturnType<typeof getConversationSnapshot>
>;

export const getConversation = createServerFn({ method: "GET" })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        agentId: Schema.UUID,
        since: Schema.optional(Schema.NonNegativeInt),
        before: Schema.optional(Schema.NonNegativeInt),
      }),
    ),
  )
  .handler(async ({ data }) => {
    if (
      appGate().mode === "drain" ||
      (await Effect.runPromise(withAgentStore(isMaintenance)))
    )
      return result(readConversationSnapshot(data.agentId, data));
    startWorker();

    return result(
      Effect.gen(function* () {
        yield* ensureTimeline(data.agentId);
        return yield* readConversationSnapshot(data.agentId, data);
      }),
    );
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(SendMessage))
  .handler(({ data }) => {
    startWorker();

    return result(
      Effect.gen(function* () {
        yield* ensureTimeline(data.agentId);

        return yield* enqueueChat(data);
      }),
    );
  });

// Let the user stop existing work while an update waits for runs to drain.
export const stopMessage = createServerFn({ method: "POST" })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.UUID }),
    ),
  )
  .handler(({ data }) => result(cancelRun(data.agentId, data.id)));

export const getActivityOutput = createServerFn({ method: "GET" })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.String }),
    ),
  )
  .handler(({ data }) =>
    result(
      withAgentStore((db) => {
        const row = db
          .prepare("SELECT message FROM timeline WHERE agentId=? AND id=?")
          .get(data.agentId, data.id);

        return row
          ? (JSON.parse(String(row.message)) as import("./schema").Message)
          : null;
      }),
    ),
  );
