import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import {
  AgentStoreError,
  withAgentStore,
} from "../../server/agents/store.server";
import {
  deleteAutomation,
  readAutomations,
  saveAutomation,
  toggleAutomation,
} from "../../server/automations/store.server";
import { available } from "../../server/available";
import type { Run } from "../../server/runs/store.server";
import {
  cancelRun,
  readRunSummaries,
  runAutomationNow,
} from "../../server/runs/store.server";
import { startWorker } from "../../server/runs/worker.server";
import { AutomationInput } from "./schema";

const result = <A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );

const AgentId = Schema.Struct({ agentId: Schema.UUID });
const Entry = Schema.Struct({ ...AgentId.fields, id: Schema.UUID });

export const getAgentAutomations = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(AgentId))
  .handler(({ data }) =>
    result(
      withAgentStore((db) => ({
        automations: readAutomations(db, data.agentId),
        runs: readRunSummaries(db, data.agentId),
      })),
    ),
  );

export const saveAgentAutomation = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        ...AutomationInput.fields,
        expectedRevision: Schema.optional(Schema.Number),
      }),
    ),
  )
  .handler(({ data }) => {
    startWorker();

    return result(saveAutomation(data, data.expectedRevision));
  });

export const toggleAgentAutomation = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        ...Entry.fields,
        revision: Schema.Number,
        enabled: Schema.Boolean,
      }),
    ),
  )
  .handler(({ data }) =>
    result(
      toggleAutomation(data.agentId, data.id, data.revision, data.enabled),
    ),
  );

export const runAgentAutomation = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ ...Entry.fields, requestId: Schema.UUID }),
    ),
  )
  .handler(({ data }) => {
    startWorker();

    return result(runAutomationNow(data.agentId, data.id, data.requestId));
  });

export const deleteAgentAutomation = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ ...Entry.fields, revision: Schema.NonNegativeInt }),
    ),
  )
  .handler(({ data }) =>
    result(deleteAutomation(data.agentId, data.id, data.revision)),
  );

// Stopping existing scheduled work must remain possible during an update.
export const stopAgentRun = createServerFn({ method: "POST" })
  .validator(Schema.decodeUnknownSync(Entry))
  .handler(({ data }) => result(cancelRun(data.agentId, data.id)));

export const getAgentRun = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Entry))
  .handler(({ data }) =>
    result(
      withAgentStore((db) => {
        const run = db
          .prepare("SELECT * FROM runs WHERE agentId=? AND id=?")
          .get(data.agentId, data.id) as Run | undefined;
        if (!run) throw new AgentStoreError({ message: "Run not found." });
        return run;
      }),
    ),
  );
