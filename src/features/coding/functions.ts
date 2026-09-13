import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import { stopCodingJob as requestCodingStop } from "../../server/coding/jobs.server";
import {
  getCodingPreference,
  setCodingPreference,
} from "../../server/coding/preference.server";
import {
  deleteExecutionProfile,
  getCodingSettings,
  listCodingJobs,
  listExecutionProfiles,
  saveCodingSettings,
  saveExecutionProfile,
} from "../../server/coding/store.server";
import { CodingSettings, ExecutionProfile } from "./schema";

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
  .handler(({ data }) => result(listCodingJobs(data.agentId)));

export const stopCodingJob = createServerFn({ method: "POST" })
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.UUID }),
    ),
  )
  .handler(({ data }) => result(requestCodingStop(data.agentId, data.id)));

export const getCodingSetting = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => result(getCodingPreference()));
export const changeCodingSetting = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean })),
  )
  .handler(({ data }) => result(setCodingPreference(data.enabled)));
