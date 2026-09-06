import { computerAction } from "../computer/tools.server";
import { CODEX_SIGN_IN_REQUIRED } from "../../features/auth/schema";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Schema,
  JSONSchema,
} from "effect";
import { CodexError, openAppServer, openHostServer } from "./app-server.server";
import { readSoul, patchSoul, SoulPatch } from "../agents/soul.server";
import type { DynamicToolSpec } from "./protocol/v2/DynamicToolSpec";
import type { DynamicToolCallResponse } from "./protocol/v2/DynamicToolCallResponse";
import type { LoginAccountParams } from "./protocol/v2/LoginAccountParams";
import { AutomationInput } from "../../features/automations/schema";
import {
  listAutomations,
  saveAutomation,
  toggleAutomation,
} from "../automations/store.server";
import { runAutomationNow } from "../runs/store.server";
import type { JsonValue } from "./protocol/serde_json/JsonValue";

const hostHome = () =>
  resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));

const Auth = Schema.Struct({
  OPENAI_API_KEY: Schema.optional(Schema.NullOr(Schema.String)),
  tokens: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ access_token: Schema.String, account_id: Schema.String }),
    ),
  ),
});
const HostConfig = Schema.Struct({
  config: Schema.Struct({
    features: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    ),
    apps: Schema.optional(
      Schema.NullOr(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      ),
    ),
  }),
});

const hostCredentials = Effect.scoped(
  Effect.gen(function* () {
    const host = yield* openHostServer();
    yield* host.initialize;
    // The host owns refresh-token rotation; isolated homes only receive access tokens.
    yield* host.request("account/read", { refreshToken: true });
    return yield* Effect.try({
      try: () => {
        const auth = Schema.decodeUnknownSync(Auth)(
          JSON.parse(readFileSync(join(hostHome(), "auth.json"), "utf8")),
        );
        if (auth.tokens)
          return {
            type: "chatgptAuthTokens",
            accessToken: auth.tokens.access_token,
            chatgptAccountId: auth.tokens.account_id,
          } satisfies LoginAccountParams;
        if (auth.OPENAI_API_KEY)
          return {
            type: "apiKey",
            apiKey: auth.OPENAI_API_KEY,
          } satisfies LoginAccountParams;
        throw new Error();
      },
      catch: () =>
        new CodexError({
          message: CODEX_SIGN_IN_REQUIRED,
        }),
    });
  }),
);

const SaveAutomationTool = Schema.Struct({
  ...AutomationInput.omit("agentId").fields,
  expectedRevision: Schema.optional(Schema.Number),
});
const ToggleAutomationTool = Schema.Struct({
  id: Schema.UUID,
  revision: Schema.Number,
  enabled: Schema.Boolean,
});
const RunAutomationTool = Schema.Struct({
  id: Schema.UUID,
  requestId: Schema.UUID,
});

export const soulTools: DynamicToolSpec[] = [
  {
    type: "function",
    name: "roost_read_soul",
    description:
      "Read your own persistent SOUL.md and its current revision before editing it.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_update_soul",
    description:
      "Apply exact targeted edits to your soul after the user explicitly requests a lasting change or agrees to your proposed change. Read the soul first, preserve unrelated text, and supply a short reason. Do not store schedules or personal facts here.",
    inputSchema: JSONSchema.make(SoulPatch) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_list_automations",
    description:
      "Read the current time and server timezone, and list your saved automations, IDs, schedules, enablement, and revisions. Call this before scheduling relative times.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_save_automation",
    description:
      "Create or edit an automation for this agent when explicitly requested by the user. Use a stable UUID for a creation; for an edit use the existing id and expectedRevision from the list tool. Prefer ONE cron automation for multiple daily times: kind=cron, expression='0 8-22/2 * * *' means every two hours from 08:00 through 22:00 daily. Cron uses five fields: minute hour day-of-month month day-of-week. Timezone must be an IANA name. Recurring schedules accept optional startsOn and endsOn as inclusive YYYY-MM-DD calendar dates in that timezone. Do not invent an end date for a condition such as until delivered. Weekly days are 0=Sunday through 6=Saturday. One-time timestamps need an explicit offset. Ask if the task or intended time is unclear. Schedules do not expand your permissions.",
    inputSchema: JSONSchema.make(SaveAutomationTool) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_set_automation_enabled",
    description:
      "Pause or resume an existing automation at the user's request. Read its current revision first. Pausing cancels queued runs; an active run continues until explicitly stopped.",
    inputSchema: JSONSchema.make(ToggleAutomationTool) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_run_automation",
    description:
      "Queue one immediate run of a saved automation at the user's request. Use a stable requestId UUID so retries don't create duplicate runs.",
    inputSchema: JSONSchema.make(RunAutomationTool) as unknown as JsonValue,
  },
];
const ToolCall = Schema.Struct({
  threadId: Schema.String,
  namespace: Schema.NullOr(Schema.String),
  tool: Schema.String,
  arguments: Schema.Unknown,
});

// config/read includes null defaults; thread overrides are converted to TOML,
// which has no null value. Omit those defaults instead of turning them into strings.
function omitNulls(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(omitNulls);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry != null)
        .map(([key, entry]) => [key, omitNulls(entry!)]),
    );
  return value;
}

const makeAgentServer = (
  agentId: string,
  codexHome: string,
  workspace: string,
) =>
  Effect.gen(function* () {
    const credentials = yield* hostCredentials;
    const { config } = yield* Effect.scoped(
      Effect.gen(function* () {
        const host = yield* openHostServer();
        yield* host.initialize;
        return yield* host
          .request("config/read", { includeLayers: false })
          .pipe(Effect.flatMap(Schema.decodeUnknown(HostConfig)));
      }),
    );
    yield* Effect.try({
      try: () => mkdirSync(codexHome, { recursive: true, mode: 0o700 }),
      catch: () =>
        new CodexError({
          message: "Could not prepare this agent's Codex home.",
        }),
    });
    const client = yield* openAppServer(
      undefined,
      [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        `sqlite_home=${JSON.stringify(codexHome)}`,
        "-c",
        "features.memories=true",
        "-c",
        "memories.generate_memories=true",
        "-c",
        "memories.use_memories=true",
        "-c",
        `features.apps=${config.features?.apps === true}`,
        "-c",
        "features.hooks=false",
        "-c",
        "project_doc_max_bytes=0",
        "-c",
        'cli_auth_credentials_store="file"',
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          CODEX_SQLITE_HOME: codexHome,
          CODEX_ACCESS_TOKEN: undefined,
        },
      },
    );
    let threadId: string | undefined;
    let allowMutations = false;
    client.onRequest = async (method, params) => {
      if (method === "account/chatgptAuthTokens/refresh") {
        const auth = await Effect.runPromise(hostCredentials);
        if (auth.type !== "chatgptAuthTokens") throw new Error();
        return {
          accessToken: auth.accessToken,
          chatgptAccountId: auth.chatgptAccountId,
          chatgptPlanType: null,
        };
      }
      if (method !== "item/tool/call") throw new Error();
      const call = Schema.decodeUnknownSync(ToolCall)(params);
      if (call.threadId !== threadId || call.namespace !== null)
        throw new Error();
      if (call.tool === "roost_computer")
        return Effect.runPromise(computerAction(agentId, call.arguments));
      const action = Effect.gen(function* () {
        if (call.tool === "roost_read_soul") return yield* readSoul(agentId);
        if (call.tool === "roost_list_automations")
          return {
            automations: yield* listAutomations(agentId),
            currentTime: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
        if (!allowMutations)
          return yield* new CodexError({
            message: "Automated runs cannot change souls or automations.",
          });
        if (call.tool === "roost_update_soul")
          return yield* patchSoul(
            agentId,
            yield* Schema.decodeUnknown(SoulPatch)(call.arguments),
          );
        if (call.tool === "roost_save_automation") {
          const args = yield* Schema.decodeUnknown(SaveAutomationTool)(
            call.arguments,
          );
          return yield* saveAutomation(
            { ...args, agentId },
            args.expectedRevision,
          );
        }
        if (call.tool === "roost_set_automation_enabled") {
          const args = yield* Schema.decodeUnknown(ToggleAutomationTool)(
            call.arguments,
          );
          yield* toggleAutomation(
            agentId,
            args.id,
            args.revision,
            args.enabled,
          );
          return { updated: true };
        }
        if (call.tool === "roost_run_automation") {
          const args = yield* Schema.decodeUnknown(RunAutomationTool)(
            call.arguments,
          );
          return yield* runAutomationNow(agentId, args.id, args.requestId);
        }
        return yield* new CodexError({ message: "Unknown Roost tool." });
      });
      return Effect.runPromise(
        action.pipe(
          Effect.match({
            onSuccess: (value): DynamicToolCallResponse => ({
              success: true,
              contentItems: [
                { type: "inputText", text: JSON.stringify(value) },
              ],
            }),
            onFailure: (error): DynamicToolCallResponse => ({
              success: false,
              contentItems: [
                {
                  type: "inputText",
                  text:
                    "message" in error ? error.message : "Invalid soul update.",
                },
              ],
            }),
          }),
        ),
      );
    };
    yield* client.initialize;
    yield* client.request("account/login/start", credentials);
    return {
      client,
      bindThread: (id: string, mutations = true) => {
        threadId = id;
        allowMutations = mutations;
      },
      config: { apps: omitNulls((config.apps ?? {}) as unknown as JsonValue) },
    };
  });

// Reuse one process per active agent. Allow native background memory work to
// finish after a reply instead of killing it when the HTTP stream closes.
const AgentClient =
  Context.GenericTag<Effect.Effect.Success<ReturnType<typeof makeAgentServer>>>(
    "RoostAgentClient",
  );
type RuntimeEntry = {
  runtime: ManagedRuntime.ManagedRuntime<
    Context.Tag.Identifier<typeof AgentClient>,
    Effect.Effect.Error<ReturnType<typeof makeAgentServer>>
  >;
  users: number;
  idle?: ReturnType<typeof setTimeout>;
};
const globals = globalThis as typeof globalThis & {
  roostAgentRuntimes?: Map<string, RuntimeEntry>;
};
const runtimes = (globals.roostAgentRuntimes ??= new Map<
  string,
  RuntimeEntry
>());

export const closeAgentRuntimes = async () => {
  const entries = [...runtimes.values()];
  runtimes.clear();
  await Promise.all(
    entries.map((entry) => {
      clearTimeout(entry.idle);
      return entry.runtime.dispose();
    }),
  );
};

// A new host login must replace cached access tokens without interrupting replies.
export const refreshAgentRuntimes = async () => {
  const idle = [...runtimes.values()].filter((entry) => entry.users === 0);
  runtimes.clear();
  await Promise.all(
    idle.map((entry) => {
      clearTimeout(entry.idle);
      return entry.runtime.dispose();
    }),
  );
};

export const openAgentServer = (
  agentId: string,
  codexHome: string,
  workspace: string,
) =>
  Effect.gen(function* () {
    const entry = yield* Effect.acquireRelease(
      Effect.sync(() => {
        let entry = runtimes.get(codexHome);
        if (!entry) {
          entry = {
            users: 0,
            runtime: ManagedRuntime.make(
              Layer.scoped(
                AgentClient,
                makeAgentServer(agentId, codexHome, workspace),
              ),
            ),
          };
          runtimes.set(codexHome, entry);
        }
        clearTimeout(entry.idle);
        entry.users++;
        return entry;
      }),
      (entry) =>
        Effect.sync(() => {
          entry.users--;
          if (entry.users) return;
          if (runtimes.get(codexHome) !== entry) {
            void entry.runtime.dispose();
            return;
          }
          entry.idle = setTimeout(
            () => {
              if (runtimes.get(codexHome) === entry) runtimes.delete(codexHome);
              void entry.runtime.dispose();
            },
            10 * 60 * 1000,
          );
          entry.idle.unref();
        }),
    );
    return yield* Effect.promise(() =>
      entry.runtime.runPromiseExit(AgentClient),
    ).pipe(
      Effect.flatten,
      Effect.filterOrFail(
        (value) => value.client.connected,
        () => new CodexError({ message: "Codex disconnected. Please retry." }),
      ),
      Effect.tapError(() =>
        Effect.promise(async () => {
          if (runtimes.get(codexHome) === entry) runtimes.delete(codexHome);
          await entry.runtime.dispose();
        }),
      ),
    );
  });
