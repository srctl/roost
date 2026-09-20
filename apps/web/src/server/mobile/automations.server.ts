import { Effect, ParseResult, Schema } from "effect";
import { AutomationInput, Schedule } from "../../features/automations/schema";
import { withAgentStore } from "../agents/store.server";
import { nextOccurrence, scheduleLabel } from "../automations/schedule";
import {
  deleteAutomation,
  readAutomations,
  requireAgent,
  saveAutomation,
  toggleAutomation,
} from "../automations/store.server";
import { getCodexConnection } from "../codex/app-server.server";
import { assertAvailable } from "../maintenance.server";
import {
  cancelRun,
  type Run,
  readRunSummaries,
  runAutomationNow,
} from "../runs/store.server";

const uuid = Schema.decodeUnknownSync(Schema.UUID);
const revision = Schema.Struct({ revision: Schema.NonNegativeInt });

async function run<A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === "Left") throw new Error(result.left.message);
  return result.right;
}

// This dispatcher is called only after mobile bearer and origin checks.
export async function mobileAutomationRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
  prepare: (agentId: string) => Promise<void>,
) {
  const match =
    /^agents\/([^/]+)\/(automations|runs)(?:\/([^/]+))?(?:\/(toggle|run|stop))?$/.exec(
      path,
    );
  if (!match) return null;
  try {
    const agentId = uuid(match[1]);
    const section = match[2];
    const entry = match[3];
    const action = match[4];
    // Existing work can still be stopped during maintenance.
    await run(
      withAgentStore((db) => {
        requireAgent(db, agentId);
        if (!(section === "runs" && action === "stop")) assertAvailable(db);
      }),
    );

    if (section === "automations" && !entry && request.method === "GET") {
      return {
        value: await run(
          withAgentStore((db) => ({
            automations: readAutomations(db, agentId),
            runs: readRunSummaries(db, agentId),
          })),
        ),
      };
    }
    if (
      section === "automations" &&
      entry === "models" &&
      !action &&
      request.method === "GET"
    ) {
      const connection = await run(getCodexConnection);
      return {
        value: {
          models: connection.models.map(({ model, displayName }) => ({
            model,
            displayName,
          })),
        },
      };
    }
    if (
      section === "automations" &&
      entry === "preview" &&
      !action &&
      request.method === "POST"
    ) {
      const input = Schema.decodeUnknownSync(
        Schema.Struct({ schedule: Schedule }),
      )(await body(request));
      const runs: number[] = [];
      let after = Date.now();
      for (let index = 0; index < 3; index++) {
        const next = nextOccurrence(input.schedule, after);
        if (next === null) break;
        runs.push(next);
        after = next;
      }
      if (!runs.length)
        throw new Error("No future runs match this schedule and date range.");
      return { value: { runs, label: scheduleLabel(input.schedule) } };
    }
    if (section === "automations" && !entry && request.method === "POST") {
      const input = Schema.decodeUnknownSync(
        Schema.Struct({
          ...AutomationInput.fields,
          expectedRevision: Schema.optional(Schema.NonNegativeInt),
        }),
      )({ ...((await body(request)) as object), agentId });
      const saved = await run(saveAutomation(input, input.expectedRevision));
      await prepare(agentId);
      return { value: saved };
    }
    if (
      section === "automations" &&
      entry &&
      !["models", "preview"].includes(entry)
    ) {
      const id = uuid(entry);
      if (!action && request.method === "DELETE") {
        const input = Schema.decodeUnknownSync(revision)(await body(request));
        await run(deleteAutomation(agentId, id, input.revision));
        return { value: { ok: true } };
      }
      if (action === "toggle" && request.method === "POST") {
        const input = Schema.decodeUnknownSync(
          Schema.Struct({
            ...revision.fields,
            enabled: Schema.Boolean,
          }),
        )(await body(request));
        await run(toggleAutomation(agentId, id, input.revision, input.enabled));
        return { value: { ok: true } };
      }
      if (action === "run" && request.method === "POST") {
        const input = Schema.decodeUnknownSync(
          Schema.Struct({ requestId: Schema.UUID }),
        )(await body(request));
        const value = await run(runAutomationNow(agentId, id, input.requestId));
        await prepare(agentId);
        return { value, status: 202 };
      }
    }
    if (section === "runs" && entry) {
      const id = uuid(entry);
      const entryRun = await run(
        withAgentStore(
          (db) =>
            db
              .prepare("SELECT * FROM runs WHERE agentId=? AND id=?")
              .get(agentId, id) as Run | undefined,
        ),
      );
      if (!entryRun) return { value: { error: "Run not found." }, status: 404 };
      if (!action && request.method === "GET") return { value: entryRun };
      if (action === "stop" && request.method === "POST") {
        Schema.decodeUnknownSync(Schema.Struct({}))(await body(request));
        await run(cancelRun(agentId, id));
        return { value: { ok: true } };
      }
    }
    return { value: { error: "Method not allowed." }, status: 405 };
  } catch (error) {
    const message = ParseResult.isParseError(error)
      ? "Check the required fields and choose a valid schedule."
      : error instanceof Error
        ? error.message
        : "Could not update this automation.";
    const conflict = /changed|already exists|already been used/.test(message);
    return { value: { error: message }, status: conflict ? 409 : 400 };
  }
}
