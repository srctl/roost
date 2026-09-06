import { available } from "../../server/available";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { SendMessage } from "./schema";
import { ensureTimeline, startWorker } from "../../server/runs/worker.server";
import { readTimeline } from "../../server/runs/timeline.server";
import { enqueueChat, cancelRun } from "../../server/runs/store.server";
import { withAgentStore } from "../../server/agents/store.server";

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
export const getConversation = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.UUID))
  .handler(({ data }) => {
    startWorker();
    return result(
      Effect.gen(function* () {
        yield* ensureTimeline(data);
        const messages = yield* readTimeline(data);
        const run = yield* withAgentStore((db) =>
          db
            .prepare(
              "SELECT id,status FROM runs WHERE agentId=? AND status IN ('running','queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,createdAt LIMIT 1",
            )
            .get(data),
        );
        return { messages, busy: !!run, runId: run ? String(run.id) : null };
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
export const stopMessage = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.UUID }),
    ),
  )
  .handler(({ data }) => result(cancelRun(data.agentId, data.id)));
