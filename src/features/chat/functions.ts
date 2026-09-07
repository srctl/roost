import { available } from "../../server/available";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { SendMessage } from "./schema";
import { ensureTimeline, startWorker } from "../../server/runs/worker.server";
import { readTimelinePage } from "../../server/runs/timeline.server";
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
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        agentId: Schema.UUID,
        since: Schema.optional(Schema.NonNegativeInt),
        before: Schema.optional(Schema.NonNegativeInt),
      }),
    ),
  )
  .handler(({ data }) => {
    startWorker();

    return result(
      Effect.gen(function* () {
        yield* ensureTimeline(data.agentId);
        const page = yield* withAgentStore((db) =>
          readTimelinePage(db, data.agentId, data),
        );
        const run = yield* withAgentStore((db) =>
          db
            .prepare(
              "SELECT id,status FROM runs WHERE agentId=? AND status IN ('running','queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,createdAt LIMIT 1",
            )
            .get(data.agentId),
        );
        const computer = run
          ? yield* withAgentStore((db) =>
              db
                .prepare(
                  "SELECT id FROM timeline WHERE agentId=? AND position>(SELECT position FROM timeline WHERE agentId=? AND id=?) AND json_extract(message,'$.title')='roost_computer' ORDER BY position DESC LIMIT 1",
                )
                .get(data.agentId, data.agentId, String(run.id)),
            )
          : undefined;

        return {
          ...page,
          busy: !!run,
          runId: run ? String(run.id) : null,
          computerAnchor: computer ? String(computer.id) : null,
        };
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
  .middleware([available])
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
