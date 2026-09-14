import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Data, Effect, Schema } from "effect";
import { CODEX_SIGN_IN_REQUIRED } from "../../features/auth/schema";
import { codexErrorMessage } from "./auth-errors.server";
import type { InitializeParams } from "./protocol/InitializeParams";
import type { GetAccountParams } from "./protocol/v2/GetAccountParams";
import type { ModelListParams } from "./protocol/v2/ModelListParams";

export class CodexError extends Data.TaggedError("CodexError")<{
  message: string;
}> {}

type Pending = (result: Effect.Effect<unknown, CodexError>) => void;

// JSONL is the transport boundary. Callers use Effects, not process events.
export function openAppServer(
  command = process.env.ROOST_CODEX_BINARY ?? "codex",
  args = ["app-server", "--listen", "stdio://"],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
) {
  return Effect.acquireRelease(
    Effect.try({
      try: () =>
        new AppServer(
          spawn(command, args, {
            ...options,
            stdio: "pipe",
            windowsHide: true,
          }),
        ),
      catch: () =>
        new CodexError({
          message: "Could not start Codex. Check ROOST_CODEX_BINARY.",
        }),
    }),
    (client) => Effect.promise(() => client.close()),
  );
}

class AppServer {
  onRequest?: (
    method: string,
    params: unknown,
    requestId: string | number,
  ) => Promise<unknown>;

  get connected() {
    return !this.failure;
  }

  private nextId = 0;

  private readonly pending = new Map<number, Pending>();

  private failure: CodexError | undefined;

  private readonly lines;

  private readonly listeners = new Set<{
    message: (method: string, params: unknown) => void;
    error: (error: CodexError) => void;
  }>();

  subscribe(
    message: (method: string, params: unknown) => void,
    error: (error: CodexError) => void,
  ) {
    const listener = { message, error };
    this.listeners.add(listener);
    if (this.failure) error(this.failure);
    return () => {
      this.listeners.delete(listener);
    };
  }

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.lines = createInterface({ input: child.stdout });
    child.stderr.resume(); // Drain diagnostics without exposing local credentials to the UI.
    child.on("error", () =>
      this.fail(
        "Could not start Codex. Install the Codex CLI or set ROOST_CODEX_BINARY.",
      ),
    );
    child.on("exit", () => this.fail("Codex disconnected. Please try again."));
    child.stdin.on("error", () =>
      this.fail("The Codex connection closed. Please try again."),
    );
    this.lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error();
        message = value as Record<string, unknown>;
      } catch {
        this.fail("Codex returned an invalid protocol message.");

        return;
      }
      if (typeof message.method === "string") {
        if (message.id !== undefined) {
          const request =
            this.onRequest?.(
              message.method,
              message.params,
              message.id as string | number,
            ) ?? Promise.reject();
          void request.then(
            (result) => {
              if (!this.failure) this.send({ id: message.id, result });
            },
            () => {
              if (!this.failure)
                this.send({
                  id: message.id,
                  error: {
                    code: -32601,
                    message: "Roost could not handle this request.",
                  },
                });
            },
          );
        } else
          for (const listener of this.listeners)
            listener.message(message.method, message.params);
        return;
      }
      if (typeof message.id !== "number") return;
      const resume = this.pending.get(message.id);
      if (!resume) return;
      this.pending.delete(message.id);
      if ("error" in message) {
        resume(
          Effect.fail(
            new CodexError({
              message: codexErrorMessage(
                message.error,
                "Codex rejected the request. Check your CLI configuration and try again.",
              ),
            }),
          ),
        );

        return;
      }
      if ("result" in message) {
        resume(Effect.succeed(message.result));

        return;
      }
      resume(
        Effect.fail(
          new CodexError({ message: "Codex returned an invalid response." }),
        ),
      );
    });
  }

  private fail(message: string) {
    this.failure ??= new CodexError({ message });
    for (const resume of this.pending.values())
      resume(Effect.fail(this.failure));
    this.pending.clear();
    for (const listener of this.listeners) listener.error(this.failure);
    this.listeners.clear();
  }

  private send(message: unknown) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: unknown) {
    return Effect.async<unknown, CodexError>((resume) => {
      if (this.failure) {
        resume(Effect.fail(this.failure));

        return;
      }
      const id = this.nextId++;
      this.pending.set(id, resume);
      this.send({ id, method, params });

      return Effect.sync(() => {
        this.pending.delete(id);
      });
    }).pipe(
      Effect.timeoutFail({
        duration: "15 seconds",
        onTimeout: () =>
          new CodexError({
            message: "Codex took too long to respond. Please try again.",
          }),
      }),
    );
  }

  initialize = Effect.gen(this, function* () {
    yield* this.request("initialize", {
      clientInfo: { name: "roost", title: "Roost", version: "0.0.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    } satisfies InitializeParams);
    this.send({ method: "initialized" });
  });

  close() {
    this.fail("The Codex connection is closed.");
    this.lines.close();

    return new Promise<void>((resolve) => {
      if (
        this.child.exitCode !== null ||
        this.child.signalCode !== null ||
        !this.child.pid
      ) {
        resolve();

        return;
      }
      const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.child.kill("SIGTERM");
    });
  }
}

// Host operations discover account/configuration or read legacy history only.
export const openHostServer = () =>
  openAppServer(undefined, [
    "app-server",
    "--listen",
    "stdio://",
    "-c",
    "memories.generate_memories=false",
    "-c",
    "memories.use_memories=false",
    "-c",
    'cli_auth_credentials_store="file"',
  ]);

const AccountResponse = Schema.Struct({
  account: Schema.NullOr(Schema.Unknown),
  requiresOpenaiAuth: Schema.Boolean,
});

const ModelPage = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      model: Schema.String,
      displayName: Schema.String,
      isDefault: Schema.Boolean,
      hidden: Schema.Boolean,
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});

export const getCodexConnection = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* openHostServer();
    yield* client.initialize;
    const account = yield* client
      .request("account/read", {
        refreshToken: false,
      } satisfies GetAccountParams)
      .pipe(
        Effect.flatMap(Schema.decodeUnknown(AccountResponse)),
        Effect.mapError(
          () =>
            new CodexError({
              message:
                "Could not read Codex account status. Check your CLI installation and try again.",
            }),
        ),
      );
    if (account.requiresOpenaiAuth && !account.account) {
      return yield* new CodexError({
        message: CODEX_SIGN_IN_REQUIRED,
      });
    }
    return yield* getCodexModels(client);
  }),
);

export const getCodexModels = (client: AppServer) =>
  Effect.gen(function* () {
    const models: Array<{
      model: string;
      displayName: string;
      isDefault: boolean;
    }> = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page: typeof ModelPage.Type = yield* client
        .request("model/list", { cursor, limit: 100 } satisfies ModelListParams)
        .pipe(
          Effect.flatMap(Schema.decodeUnknown(ModelPage)),
          Effect.mapError(
            () =>
              new CodexError({
                message:
                  "Could not load Codex models. Check your CLI configuration and try again.",
              }),
          ),
        );
      models.push(
        ...page.data
          .filter((model) => !model.hidden)
          .map(({ model, displayName, isDefault }) => ({
            model,
            displayName,
            isDefault,
          })),
      );
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor))
        return yield* new CodexError({
          message: "Codex returned an invalid model catalog.",
        });
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (!models.length)
      return yield* new CodexError({
        message: "Codex has no available models. Check your CLI configuration.",
      });
    return { models };
  });
