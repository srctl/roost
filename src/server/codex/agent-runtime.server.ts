import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { CODEX_SIGN_IN_REQUIRED } from "../../features/auth/schema";
import { cancelApproval, waitForApproval } from "../approvals/store.server";
import {
  handleNativeApproval,
  isNativeApproval,
  RequestApproval,
} from "../approvals/tools.server";
import { releaseComputer } from "../computer/session.server";
import { computerAction } from "../computer/tools.server";
import { PublishArtifact, publishArtifact } from "../files/tools.server";
import { reflectionTools } from "../reflections/store.server";
import { handleAgentTool } from "./agent-tools.server";
import { CodexError, openAppServer, openHostServer } from "./app-server.server";
import type { JsonValue } from "./protocol/serde_json/JsonValue";
import type { LoginAccountParams } from "./protocol/v2/LoginAccountParams";

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

        if (auth.tokens) {
          return {
            type: "chatgptAuthTokens",
            accessToken: auth.tokens.access_token,
            chatgptAccountId: auth.tokens.account_id,
          } satisfies LoginAccountParams;
        }

        if (auth.OPENAI_API_KEY) {
          return {
            type: "apiKey",
            apiKey: auth.OPENAI_API_KEY,
          } satisfies LoginAccountParams;
        }

        throw new Error();
      },
      catch: () =>
        new CodexError({
          message: CODEX_SIGN_IN_REQUIRED,
        }),
    });
  }),
);

const ToolCall = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  namespace: Schema.NullOr(Schema.String),
  tool: Schema.String,
  arguments: Schema.Unknown,
});

// config/read includes null defaults; thread overrides are converted to TOML,
// which has no null value. Omit those defaults instead of turning them into strings.
function omitNulls(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(omitNulls);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry != null)
        .map(([key, entry]) => [key, omitNulls(entry!)]),
    );
  }

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
        // An omitted setting inherits Codex's default; only copy explicit overrides.
        ...(typeof config.features?.apps === "boolean"
          ? ["-c", `features.apps=${config.features.apps}`]
          : []),
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
    let allowMutations: boolean | "reflection" = false;
    let runId: string | undefined;
    let toolSignal: AbortSignal | undefined;
    let turnId: string | undefined;
    const changes = new Map<string, unknown>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        client.subscribe(
          (method, raw) => {
            const event = raw as {
              threadId?: string;
              turn?: { id: string };
              item?: { id: string; changes?: unknown };
              requestId?: string | number;
            };
            if (event.threadId !== threadId) return;
            if (method === "turn/started") turnId = event.turn?.id;
            if (method === "item/started" && event.item?.changes)
              changes.set(event.item.id, event.item.changes);
            if (
              method === "serverRequest/resolved" &&
              runId &&
              threadId &&
              event.requestId !== undefined
            )
              void Effect.runPromise(
                cancelApproval({
                  agentId,
                  runId,
                  threadId,
                  requestKey: JSON.stringify(event.requestId),
                }),
              ).catch(() => {});
          },
          () => {},
        ),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    client.onRequest = async (method, params, requestId) => {
      if (method === "account/chatgptAuthTokens/refresh") {
        const auth = await Effect.runPromise(hostCredentials);

        if (auth.type !== "chatgptAuthTokens") {
          throw new Error();
        }

        return {
          accessToken: auth.accessToken,
          chatgptAccountId: auth.chatgptAccountId,
          chatgptPlanType: null,
        };
      }

      const context =
        runId && threadId
          ? { agentId, runId, threadId, requestKey: JSON.stringify(requestId) }
          : undefined;
      if (isNativeApproval(method) && allowMutations === "reflection")
        throw new Error("Reflection cannot request additional permissions.");
      if (isNativeApproval(method)) {
        if (!context || !toolSignal) throw new Error("No active run.");
        releaseComputer(agentId);
        const itemId = (params as { itemId?: string }).itemId;
        return handleNativeApproval(
          context,
          method,
          params,
          turnId,
          itemId ? changes.get(itemId) : undefined,
          toolSignal,
        );
      }
      if (method !== "item/tool/call") {
        throw new Error();
      }

      const call = Schema.decodeUnknownSync(ToolCall)(params);

      if (
        call.threadId !== threadId ||
        call.turnId !== turnId ||
        call.namespace !== null ||
        !toolSignal ||
        toolSignal.aborted
      ) {
        throw new Error();
      }

      if (allowMutations === "reflection" && !reflectionTools.has(call.tool)) {
        return {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: "Reflection can only read and update its own soul.",
            },
          ],
        };
      }
      if (call.tool === "roost_computer") {
        return Effect.runPromise(computerAction(agentId, call.arguments), {
          signal: toolSignal,
        });
      }

      if (call.tool === "roost_request_approval") {
        if (!context || !toolSignal) throw new Error("No active run.");
        releaseComputer(agentId);
        const response = await waitForApproval(
          context,
          Schema.decodeUnknownSync(RequestApproval)(call.arguments),
          toolSignal,
        );
        return {
          success: true,
          contentItems: [{ type: "inputText", text: JSON.stringify(response) }],
        };
      }

      if (call.tool === "roost_publish_artifact") {
        if (!runId) throw new Error("No active run.");
        const file = await Effect.runPromise(
          publishArtifact(
            agentId,
            runId,
            Schema.decodeUnknownSync(PublishArtifact)(call.arguments),
          ),
          { signal: toolSignal },
        );
        return {
          success: true,
          contentItems: [{ type: "inputText", text: JSON.stringify(file) }],
        };
      }

      return handleAgentTool(
        { agentId, runId, allowMutations },
        call.tool,
        call.arguments,
      );
    };
    yield* client.initialize;
    yield* client.request("account/login/start", credentials);

    return {
      client,
      bindThread: (
        id: string,
        mutations: boolean | "reflection" = true,
        activeRunId?: string,
        signal?: AbortSignal,
      ) => {
        toolSignal = signal;
        turnId = undefined;
        changes.clear();
        runId = activeRunId;
        threadId = id;
        allowMutations = mutations;
      },
      bindTurn: (id: string) => {
        turnId = id;
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

globals.roostAgentRuntimes ??= new Map<string, RuntimeEntry>();
const runtimes = globals.roostAgentRuntimes;

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

          if (entry.users) {
            return;
          }

          if (runtimes.get(codexHome) !== entry) {
            void entry.runtime.dispose();

            return;
          }

          entry.idle = setTimeout(
            () => {
              if (runtimes.get(codexHome) === entry) {
                runtimes.delete(codexHome);
              }

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
          if (runtimes.get(codexHome) === entry) {
            runtimes.delete(codexHome);
          }

          await entry.runtime.dispose();
        }),
      ),
    );
  });
