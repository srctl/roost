import { Effect, Exit, Schema, Scope } from "effect";
import type { CodexLogin } from "../../features/auth/schema";
import { refreshAgentRuntimes } from "./agent-runtime.server";
import { openHostServer } from "./app-server.server";

const DeviceLogin = Schema.Struct({
  type: Schema.Literal("chatgptDeviceCode"),
  loginId: Schema.String,
  verificationUrl: Schema.String,
  userCode: Schema.String,
});

const Completion = Schema.Struct({
  loginId: Schema.NullOr(Schema.String),
  success: Schema.Boolean,
});

const Account = Schema.Struct({
  account: Schema.NullOr(Schema.Struct({ type: Schema.String })),
});

// One host login survives HTTP requests and Vite reloads. Credentials stay in Codex.
const globals = globalThis as typeof globalThis & {
  roostLogin?: {
    value: CodexLogin;
    starting?: Promise<CodexLogin>;
    cancel?: () => Promise<void>;
  };
};

globals.roostLogin ??= { value: { status: "idle" } };
const state = globals.roostLogin;

export const getLogin = () => state.value;

export const getAccount = Effect.scoped(
  Effect.gen(function* () {
    const client = yield* openHostServer();
    yield* client.initialize;
    const result = yield* client
      .request("account/read", { refreshToken: false })
      .pipe(Effect.flatMap(Schema.decodeUnknown(Account)));

    // Cached presence is not proof that the token is still valid.
    return { configured: result.account !== null };
  }).pipe(Effect.catchAll(() => Effect.succeed({ configured: false }))),
);

export function startLogin(): Promise<CodexLogin> {
  if (state.starting) return state.starting;
  if (state.value.status === "pending") return Promise.resolve(state.value);
  state.starting = begin().finally(() => {
    state.starting = undefined;
  });

  return state.starting;
}

async function begin(): Promise<CodexLogin> {
  const scope = await Effect.runPromise(Scope.make());
  let finished = false;

  let unsubscribe = () => {};

  let timer: ReturnType<typeof setTimeout> | undefined;

  const finish = async (value: CodexLogin) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    unsubscribe();
    state.value = value; // Drop device codes immediately after completion/cancellation.
    state.cancel = undefined;
    await Effect.runPromise(Scope.close(scope, Exit.void));
  };

  try {
    const client = await Effect.runPromise(
      openHostServer().pipe(Scope.extend(scope)),
    );
    await Effect.runPromise(client.initialize);
    // Register before starting: a completion can arrive alongside the RPC response.
    let earlyCompletion: typeof Completion.Type | undefined;
    let loginId: string | undefined;

    const completed = async (result: typeof Completion.Type) => {
      if (!loginId) {
        earlyCompletion = result;

        return;
      }
      if (result.loginId !== loginId || finished) return;
      if (result.success) await refreshAgentRuntimes();
      await finish(
        result.success
          ? { status: "connected" }
          : {
              status: "error",
              error:
                "Sign-in did not complete. Try again and enable device-code sign-in in your ChatGPT security settings if prompted.",
            },
      );
    };

    unsubscribe = client.subscribe(
      (method, params) => {
        if (method !== "account/login/completed") return;
        const result = Schema.decodeUnknownOption(Completion)(params);
        if (result._tag === "Some") void completed(result.value);
      },
      () => {
        void finish({
          status: "error",
          error: "Codex disconnected during sign-in. Please try again.",
        });
      },
    );
    const result = await Effect.runPromise(
      client
        .request("account/login/start", { type: "chatgptDeviceCode" })
        .pipe(Effect.flatMap(Schema.decodeUnknown(DeviceLogin))),
    );
    const url = new URL(result.verificationUrl);
    if (url.origin !== "https://auth.openai.com")
      throw new Error("Unexpected sign-in URL");
    if (finished) return state.value;
    loginId = result.loginId;
    state.value = {
      status: "pending",
      loginId,
      verificationUrl: url.href,
      userCode: result.userCode,
    };
    state.cancel = async () => {
      await Effect.runPromise(
        client.request("account/login/cancel", { loginId }).pipe(Effect.ignore),
      );
      await finish({ status: "idle" });
    };
    timer = setTimeout(
      () => {
        void finish({
          status: "error",
          error: "The sign-in code expired. Start again to get a new code.",
        });
      },
      15 * 60 * 1000,
    );
    timer.unref();
    if (earlyCompletion) await completed(earlyCompletion);
    return state.value;
  } catch {
    await finish({
      status: "error",
      error:
        "Could not start Codex sign-in. Check that Codex is installed and this machine can reach OpenAI, then try again.",
    });

    return state.value;
  }
}

export async function cancelLogin(loginId: string) {
  await state.starting;
  if (state.value.status === "pending" && state.value.loginId === loginId)
    await state.cancel?.();
  return state.value;
}

export async function closeLogin() {
  await state.starting;
  await state.cancel?.();
}

export const loginActive = () =>
  Boolean(state.starting || state.value.status === "pending");
