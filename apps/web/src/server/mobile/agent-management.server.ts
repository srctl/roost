import { Effect, Schema } from "effect";
import {
  NavigationChange,
  RenameAgentInput,
} from "../../features/agents/navigation-schema";
import {
  Character,
  CreateAgentInput,
  Name,
} from "../../features/agents/schema";
import { CodingSettings, ExecutionProfile } from "../../features/coding/schema";
import { readAgentActivity } from "../agents/activity.server";
import { DeleteAgentInput } from "../agents/delete.server";
import {
  changeAgentNavigation,
  readAgentNavigation,
  renameAgent,
} from "../agents/navigation.server";
import {
  listSoulChanges,
  readAgentMemory,
  readSoul,
  SoulUpdate,
  undoSoulChange,
  updateSoul,
} from "../agents/soul.server";
import { saveAgent, withAgentStore } from "../agents/store.server";
import { deleteAgent } from "../codex/agent-runtime.server";
import { getCodexConnection } from "../codex/app-server.server";
import {
  deleteExecutionProfile,
  getCodingSettings,
  listExecutionProfiles,
  saveCodingSettings,
  saveExecutionProfile,
} from "../coding/store.server";
import { assertAvailable } from "../maintenance.server";
import {
  ReflectionSettings,
  readReflection,
  runReflectionNow,
  saveReflection,
} from "../reflections/store.server";

export class MobileAgentManagementError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function run<A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  const result = await Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );
  if (!result.ok) throw new MobileAgentManagementError(result.error);
  return result.value;
}

export function createMobileAgentManagementRequest(
  connection = getCodexConnection,
) {
  // The outer mobile handler authenticates every route before dispatching here.
  // Sharing the web stores preserves section order, deletion fences and retries.
  return async function mobileAgentManagementRequest(
    path: string,
    request: Request,
    body: (request: Request) => Promise<unknown>,
  ): Promise<{ value: unknown; status?: number } | null> {
    const codingSettings = /^agents\/([^/]+)\/coding-settings$/.exec(path);
    const profile = /^execution-profiles(?:\/([^/]+))?$/.exec(path);
    const identity =
      /^agents\/([^/]+)\/(identity|soul|soul-undo|reflection|reflect)$/.exec(
        path,
      );
    const match = /^agents\/([^/]+)(?:\/(name))?$/.exec(path);
    if (
      ![
        "agent-options",
        "agent-navigation",
        "agent-activity",
        "agents",
      ].includes(path) &&
      !match &&
      !identity &&
      !codingSettings &&
      !profile
    )
      return null;
    // The established agents GET endpoint remains in the outer handler.
    if (path === "agents" && request.method === "GET") return null;
    await run(withAgentStore(assertAvailable));
    if (codingSettings) {
      const agentId = Schema.decodeUnknownSync(Schema.UUID)(codingSettings[1]);
      if (request.method === "GET")
        return {
          value: {
            settings: await run(getCodingSettings(agentId)),
            profiles: await run(listExecutionProfiles()),
          },
        };
      if (request.method === "POST") {
        const data = (await body(request)) as Record<string, unknown>;
        const input = Schema.decodeUnknownSync(CodingSettings)({
          ...data,
          agentId,
        });
        return { value: await run(saveCodingSettings(input)) };
      }
    }
    if (profile) {
      if (!profile[1] && request.method === "GET")
        return { value: await run(listExecutionProfiles()) };
      if (!profile[1] && request.method === "POST") {
        const input = Schema.decodeUnknownSync(ExecutionProfile)(
          await body(request),
        );
        return { value: await run(saveExecutionProfile(input)) };
      }
      if (profile[1] && request.method === "DELETE") {
        const id = Schema.decodeUnknownSync(Schema.UUID)(profile[1]);
        const { revision } = Schema.decodeUnknownSync(
          Schema.Struct({ revision: Schema.Int.pipe(Schema.nonNegative()) }),
        )(await body(request));
        return { value: await run(deleteExecutionProfile(id, revision)) };
      }
    }
    if (identity) {
      const agentId = Schema.decodeUnknownSync(Schema.UUID)(identity[1]);
      const action = identity[2];
      if (action === "identity" && request.method === "GET") {
        const soul = await run(readSoul(agentId));
        const memories = await run(readAgentMemory(agentId));
        const changes = await run(listSoulChanges(agentId));
        const reflection = await run(readReflection(agentId));
        return { value: { soul, memories, changes, reflection } };
      }
      if (request.method === "POST") {
        const data = (await body(request)) as Record<string, unknown>;
        if (action === "soul") {
          const input = Schema.decodeUnknownSync(SoulUpdate)({
            ...data,
            agentId,
          });
          return { value: await run(updateSoul(input)) };
        }
        if (action === "soul-undo") {
          const input = Schema.decodeUnknownSync(
            Schema.Struct({ id: Schema.UUID }),
          )(data);
          return { value: await run(undoSoulChange(agentId, input.id)) };
        }
        if (action === "reflection") {
          const input = Schema.decodeUnknownSync(ReflectionSettings)({
            ...data,
            agentId,
          });
          await run(saveReflection(input));
          return { value: await run(readReflection(agentId)) };
        }
        if (action === "reflect") {
          const input = Schema.decodeUnknownSync(
            Schema.Struct({ requestId: Schema.UUID }),
          )(data);
          return {
            value: await run(runReflectionNow(agentId, input.requestId)),
            status: 202,
          };
        }
      }
    }
    if (path === "agent-options" && request.method === "GET") {
      const { models } = await run(connection);
      return { value: { models, characters: Character.literals } };
    }
    if (path === "agent-activity" && request.method === "GET")
      return { value: await run(readAgentActivity()) };
    if (path === "agent-navigation") {
      if (request.method === "GET")
        return { value: await run(readAgentNavigation()) };
      if (request.method === "POST") {
        const input = Schema.decodeUnknownSync(NavigationChange)(
          await body(request),
        );
        await run(changeAgentNavigation(input));
        return { value: await run(readAgentNavigation()) };
      }
    }
    if (path === "agents" && request.method === "POST") {
      const input = Schema.decodeUnknownSync(CreateAgentInput)(
        await body(request),
      );
      const { models } = await run(connection);
      if (!models.some((model) => model.model === input.model))
        throw new MobileAgentManagementError(
          "That model is no longer available. Reload the form to choose another.",
        );
      const agent = await run(saveAgent(input));
      await run(readSoul(agent.id));
      return { value: agent, status: 201 };
    }
    if (match) {
      const agentId = Schema.decodeUnknownSync(Schema.UUID)(match[1]);
      if (match[2] === "name" && request.method === "POST") {
        const { name } = Schema.decodeUnknownSync(
          Schema.Struct({ name: Name }),
        )(await body(request));
        const input = Schema.decodeUnknownSync(RenameAgentInput)({
          agentId,
          name,
        });
        return { value: await run(renameAgent(input)) };
      }
      if (!match[2] && request.method === "DELETE") {
        const { name } = Schema.decodeUnknownSync(
          Schema.Struct({ name: Schema.String }),
        )(await body(request));
        const input = Schema.decodeUnknownSync(DeleteAgentInput)({
          agentId,
          name,
        });
        await run(deleteAgent(input));
        return { value: { ok: true } };
      }
    }
    return { value: { error: "Method not allowed." }, status: 405 };
  };
}

export const mobileAgentManagementRequest =
  createMobileAgentManagementRequest();
