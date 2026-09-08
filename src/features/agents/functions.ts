import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { readAgentActivity } from "../../server/agents/activity.server";
import {
  listSoulChanges,
  readAgentMemory,
  readSoul,
  SoulUpdate,
  undoSoulChange,
  updateSoul,
} from "../../server/agents/soul.server";
import { listAgents, saveAgent } from "../../server/agents/store.server";
import { available } from "../../server/available";
import {
  CodexError,
  getCodexConnection,
} from "../../server/codex/app-server.server";
import {
  ReflectionSettings,
  readReflection,
  runReflectionNow,
  saveReflection,
} from "../../server/reflections/store.server";
import { CreateAgentInput } from "./schema";

// Return expected failures as data so Start never exposes server error details.
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

// Read-only navigation remains available during update drain. Full startup gates
// still reject ordinary HTTP before any loader runs.
export const getAgents = createServerFn({ method: "GET" }).handler(() =>
  result(listAgents()),
);

export const getConnection = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => result(getCodexConnection));

export const createAgent = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(CreateAgentInput))
  .handler(({ data }) =>
    result(
      Effect.gen(function* () {
        const { models } = yield* getCodexConnection;
        if (!models.some((model) => model.model === data.model)) {
          return yield* new CodexError({
            message:
              "That model is no longer available. Reload the form to choose another.",
          });
        }
        const agent = yield* saveAgent(data);
        yield* readSoul(agent.id);

        return agent;
      }),
    ),
  );

export const getAgentIdentity = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.Struct({ agentId: Schema.UUID })))
  .handler(({ data }) =>
    result(
      Effect.gen(function* () {
        const soul = yield* readSoul(data.agentId);
        const memories = yield* readAgentMemory(data.agentId);
        const changes = yield* listSoulChanges(data.agentId);

        const reflection = yield* readReflection(data.agentId);
        return { soul, memories, changes, reflection };
      }),
    ),
  );

export const saveAgentSoul = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(SoulUpdate))
  .handler(({ data }) => result(updateSoul(data)));

export const getSoulHistory = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.Struct({ agentId: Schema.UUID })))
  .handler(({ data }) => result(listSoulChanges(data.agentId)));

export const undoAgentSoul = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, id: Schema.UUID }),
    ),
  )
  .handler(({ data }) => result(undoSoulChange(data.agentId, data.id)));

export const getAgentActivity = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => result(readAgentActivity()));

export const saveAgentReflection = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(ReflectionSettings))
  .handler(({ data }) => result(saveReflection(data)));

export const reflectAgentNow = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ agentId: Schema.UUID, requestId: Schema.UUID }),
    ),
  )
  .handler(({ data }) =>
    result(runReflectionNow(data.agentId, data.requestId)),
  );
