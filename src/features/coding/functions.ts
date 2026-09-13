import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { withAgentStore } from "../../server/agents/store.server";
import { available } from "../../server/available";
import { stopCodingJob as requestCodingStop } from "../../server/coding/jobs.server";
import {
  deleteExecutionProfile,
  getCodingSettings,
  listCodingJobs,
  listExecutionProfiles,
  saveCodingSettings,
  saveExecutionProfile,
} from "../../server/coding/store.server";
import { continueJobFeedback } from "../../server/coding/workspace.server";
import {
  getJobWorkspace,
  readCodingWorkspace,
  saveJobFeedback,
} from "../../server/coding/workspace-store.server";
import { CodingSettings, ExecutionProfile } from "./schema";
import { ContinueJobFeedback, JobFeedbackInput } from "./workspace-schema";

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

const AgentInput = Schema.Struct({ agentId: Schema.UUID });

export const getCodingConfiguration = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(AgentInput))
  .handler(({ data }) =>
    result(
      Effect.gen(function* () {
        const settings = yield* getCodingSettings(data.agentId);
        const profiles = yield* listExecutionProfiles();
        return { settings, profiles };
      }),
    ),
  );

export const updateCodingConfiguration = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(CodingSettings))
  .handler(({ data }) => result(saveCodingSettings(data)));

export const upsertExecutionProfile = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(ExecutionProfile))
  .handler(({ data }) => result(saveExecutionProfile(data)));

export const removeExecutionProfile = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        id: Schema.UUID,
        revision: Schema.Int.pipe(Schema.greaterThan(0)),
      }),
    ),
  )
  .handler(({ data }) =>
    result(deleteExecutionProfile(data.id, data.revision)),
  );

export const getCodingJobs = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(AgentInput))
  .handler(({ data }) =>
    result(
      Effect.gen(function* () {
        const jobs = yield* listCodingJobs(data.agentId);
        return yield* withAgentStore((db) =>
          jobs.map((job) => ({
            ...job,
            workspace: readCodingWorkspace(db, data.agentId, job.id),
          })),
        );
      }),
    ),
  );

export const stopCodingJob = createServerFn({ method: "POST" })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.UUID }),
    ),
  )
  .handler(({ data }) => result(requestCodingStop(data.agentId, data.id)));

export const getCodingWorkspace = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.UUID }),
    ),
  )
  .handler(({ data }) => result(getJobWorkspace(data.agentId, data.id)));

export const postJobFeedback = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(JobFeedbackInput))
  .handler(({ data }) => result(saveJobFeedback(data)));

export const submitJobFeedback = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(ContinueJobFeedback))
  .handler(({ data }) => result(continueJobFeedback(data)));
