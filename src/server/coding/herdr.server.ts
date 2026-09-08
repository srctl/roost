import { execFile, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Grounded in Herdr's bundled protocol 22 schema and `agent start --help`.
// Every operation targets a Roost-owned named session, never the focused pane.
export interface HerdrTarget {
  sessionName: string;
  remoteTarget: string;
}

export type HerdrWorkerState =
  | "working"
  | "blocked"
  | "idle"
  | "done"
  | "unknown"
  | "missing";

export interface HerdrWorker {
  state: HerdrWorkerState;
  output: string;
  sessionIdentity: string | null;
  paneId?: string;
  workspaceId?: string;
  nativeSessionId?: string;
}

export interface HerdrStartOptions {
  cwd: string;
  workerKind: string;
  workerName: string;
  brief: string;
  signal?: AbortSignal;
  beforeSend?: () => Promise<void>;
}

type Stage = "prepare" | "launch" | "prompt" | "read" | "stop";

export class HerdrError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stage: Stage,
    readonly uncertain = false,
  ) {
    super(message);
    this.name = "HerdrError";
  }
}

export interface HerdrCommand {
  file: string;
  args: string[];
  timeoutMs: number;
  detached: boolean;
  signal?: AbortSignal;
}

export type HerdrCommandRunner = (
  command: HerdrCommand,
) => Promise<{ stdout: string; stderr: string }>;

const MAX_OUTPUT = 1024 * 1024;
const OUTPUT_TAIL = 24_000;
const WORKER_KINDS = new Set([
  "pi",
  "claude",
  "codex",
  "gemini",
  "cursor",
  "devin",
  "agy",
  "cline",
  "omp",
  "mastracode",
  "opencode",
  "copilot",
  "kimi",
  "kiro",
  "droid",
  "amp",
  "grok",
  "hermes",
  "kilo",
  "qodercli",
  "qwen",
  "maki",
  "muse",
]);

function environment() {
  const env = { ...process.env };
  // A Roost coordinator's private runtime must not become the worker's auth
  // home, nor may an inherited Herdr socket redirect a named-session request.
  for (const key of Object.keys(env)) {
    if (
      (key.startsWith("HERDR_") && key !== "HERDR_CONFIG_PATH") ||
      key === "CODEX_HOME" ||
      key === "CODEX_SQLITE_HOME" ||
      key === "CODEX_ACCESS_TOKEN" ||
      key.startsWith("ROOST_AGENT_") ||
      key.startsWith("ROOST_RUN_")
    )
      delete env[key];
  }
  return env;
}

const runCommand: HerdrCommandRunner = (command) =>
  new Promise((resolve, reject) => {
    if (command.signal?.aborted) {
      reject(new Error("Herdr operation aborted"));
      return;
    }
    if (command.detached) {
      const child = spawn(command.file, command.args, {
        detached: true,
        stdio: "ignore",
        env: environment(),
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve({ stdout: "", stderr: "" });
      });
      return;
    }
    execFile(
      command.file,
      command.args,
      {
        encoding: "utf8",
        env: environment(),
        timeout: command.timeoutMs,
        maxBuffer: MAX_OUTPUT,
        signal: command.signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          // Do not expose execFile's message: it includes the complete command and
          // the user's brief. Structured server errors carry the useful detail.
          reject(
            Object.assign(new Error("Herdr command failed"), {
              code: error.code,
              killed: error.killed,
              stderr,
              stdout,
            }),
          );
        } else resolve({ stdout, stderr });
      },
    );
  });

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parse(value: string): Record<string, unknown> {
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function requiredString(value: unknown, label: string, stage: Stage) {
  if (typeof value !== "string" || !value) {
    throw new HerdrError(
      `Herdr response is missing ${label}`,
      "invalid_response",
      stage,
      stage !== "read",
    );
  }
  return value;
}

function validateTarget(target: HerdrTarget) {
  if (!/^roost-[a-zA-Z0-9][a-zA-Z0-9._-]{0,57}$/.test(target.sessionName)) {
    throw new HerdrError(
      "Use a Roost-owned named session (roost-..., at most 64 characters)",
      "invalid_target",
      "prepare",
    );
  }
  if (
    target.remoteTarget &&
    !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(
      target.remoteTarget,
    )
  ) {
    throw new HerdrError(
      "Remote target must be an SSH host alias or user@hostname",
      "invalid_target",
      "prepare",
    );
  }
}

function validateName(name: string) {
  if (!/^roost-[a-z0-9][a-z0-9_-]{0,25}$/.test(name)) {
    throw new HerdrError(
      "Worker name must be a unique roost-... name",
      "invalid_target",
      "prepare",
    );
  }
}

function validateBrief(brief: string) {
  if (!brief.trim() || brief.includes("\0") || brief.length > 64_000) {
    throw new HerdrError(
      "A brief must contain 1 to 64000 characters without null bytes",
      "invalid_brief",
      "prompt",
    );
  }
}

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function failure(error: unknown, stage: Stage, mutating: boolean) {
  if (error instanceof HerdrError) return error;
  const details = record(error);
  const serverError = record(parse(String(details.stderr ?? "")).error);
  const code =
    typeof serverError.code === "string"
      ? serverError.code
      : details.killed
        ? "timeout"
        : String(details.code ?? "transport_error");
  const message =
    typeof serverError.message === "string"
      ? serverError.message.slice(0, 1500)
      : code === "ENOENT"
        ? "Herdr is not installed or is not on PATH"
        : code === "timeout"
          ? "Herdr timed out; inspect the existing worker before retrying"
          : "Herdr could not be reached; inspect the existing worker before retrying";
  return new HerdrError(message, code, stage, mutating);
}

function workerFrom(
  result: Record<string, unknown>,
  name: string,
  stage: Stage,
): HerdrWorker {
  const agent = record(result.agent);
  if (agent.name !== name)
    throw new HerdrError(
      "The worker name no longer owns this terminal",
      "identity_changed",
      stage,
    );
  const terminalId = requiredString(agent.terminal_id, "terminal_id", stage);
  const rawState = agent.agent_status;
  const state = ["working", "blocked", "idle", "done", "unknown"].includes(
    String(rawState),
  )
    ? (rawState as HerdrWorkerState)
    : "unknown";
  return {
    state,
    output: "",
    // Terminal identity is available immediately and remains stable when the
    // optional native agent-session hook reports its identity later.
    sessionIdentity: `terminal:${terminalId}`,
    paneId: requiredString(agent.pane_id, "pane_id", stage),
    workspaceId: requiredString(agent.workspace_id, "workspace_id", stage),
    nativeSessionId:
      typeof record(agent.agent_session).value === "string"
        ? (record(agent.agent_session).value as string)
        : undefined,
  };
}

function verifyIdentity(
  worker: HerdrWorker,
  expected: string | undefined,
  stage: Stage,
) {
  const nativeSeparator = expected?.indexOf("|session:") ?? -1;
  const terminalIdentity =
    nativeSeparator < 0 ? expected : expected?.slice(0, nativeSeparator);
  const nativeIdentity =
    nativeSeparator < 0 ? undefined : expected?.slice(nativeSeparator + 9);
  if (
    (terminalIdentity && worker.sessionIdentity !== terminalIdentity) ||
    (nativeIdentity !== undefined && worker.nativeSessionId !== nativeIdentity)
  ) {
    throw new HerdrError(
      "The coding worker's terminal identity changed; inspect it before sending input",
      "identity_changed",
      stage,
    );
  }
}

function knownIdentity(worker: HerdrWorker) {
  if (!worker.sessionIdentity) return undefined;
  return worker.nativeSessionId
    ? `${worker.sessionIdentity}|session:${worker.nativeSessionId}`
    : worker.sessionIdentity;
}

export function createHerdrAdapter(runner: HerdrCommandRunner = runCommand) {
  async function command(
    target: HerdrTarget,
    args: string[],
    stage: Stage,
    options: {
      mutating?: boolean;
      raw?: boolean;
      timeoutMs?: number;
      detached?: boolean;
      signal?: AbortSignal;
    } = {},
  ) {
    validateTarget(target);
    options.signal?.throwIfAborted();
    const argv = ["--session", target.sessionName, ...args];
    let file = process.env.ROOST_HERDR_BINARY || "herdr";
    let commandArgs = argv;
    let detached = options.detached ?? false;
    if (target.remoteTarget) {
      // SSH executes its command through a remote shell; quote each argument
      // independently and keep all shell syntax fixed, including daemon setup.
      const remote = ["herdr", ...argv].map(quote).join(" ");
      const shell = detached
        ? `nohup ${remote} </dev/null >/dev/null 2>&1 &`
        : remote;
      file = "ssh";
      commandArgs = [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "--",
        target.remoteTarget,
        shell,
      ];
      detached = false;
    }
    try {
      const response = await runner({
        file,
        args: commandArgs,
        timeoutMs: options.timeoutMs ?? 15_000,
        detached,
        signal: options.signal,
      });
      if (options.raw || options.detached) return { text: response.stdout };
      const envelope = parse(response.stdout);
      const serverError = record(envelope.error);
      if (typeof serverError.code === "string") {
        throw new HerdrError(
          String(serverError.message ?? "Herdr request failed"),
          serverError.code,
          stage,
          options.mutating,
        );
      }
      const result = record(envelope.result);
      if (typeof result.type !== "string")
        throw new HerdrError(
          "Herdr returned an invalid response",
          "invalid_response",
          stage,
          options.mutating,
        );
      return result;
    } catch (error) {
      throw failure(error, stage, options.mutating ?? false);
    }
  }

  async function getWorker(
    target: HerdrTarget,
    name: string,
    stage: Stage,
    signal?: AbortSignal,
  ) {
    validateName(name);
    return workerFrom(
      await command(target, ["agent", "get", name], stage, { signal }),
      name,
      stage,
    );
  }

  async function readCodingWorker(
    target: HerdrTarget,
    name: string,
    signal?: AbortSignal,
  ): Promise<HerdrWorker> {
    try {
      const worker = await getWorker(target, name, "read", signal);
      const output = await command(
        target,
        [
          "agent",
          "read",
          worker.paneId!,
          "--source",
          "recent-unwrapped",
          "--lines",
          "200",
          "--format",
          "text",
        ],
        "read",
        { raw: true, signal },
      );
      // Recheck ownership so a name reassignment during output capture cannot
      // attach another worker's output to this job.
      const after = await getWorker(target, name, "read", signal);
      verifyIdentity(after, knownIdentity(worker), "read");
      return { ...after, output: String(output.text).slice(-OUTPUT_TAIL) };
    } catch (error) {
      if (
        error instanceof HerdrError &&
        [
          "agent_not_found",
          "agent_name_not_found",
          "pane_not_found",
          "server_not_running",
        ].includes(error.code)
      ) {
        return { state: "missing", output: "", sessionIdentity: null };
      }
      throw error;
    }
  }

  async function promptCodingWorker(
    target: HerdrTarget,
    name: string,
    brief: string,
    expectedIdentity?: string,
    signal?: AbortSignal,
    beforeSend?: () => Promise<void>,
  ): Promise<HerdrWorker> {
    validateBrief(brief);
    const existing = await getWorker(target, name, "prompt", signal);
    verifyIdentity(existing, expectedIdentity, "prompt");
    if (existing.state === "working" || existing.state === "unknown") {
      throw new HerdrError(
        "Wait for the current coding turn to settle before continuing",
        "worker_busy",
        "prompt",
      );
    }
    // Herdr rejects already-blocked agents before sending input. Keep that
    // behavior: trust/auth/permission dialogs require explicit human handling.
    if (existing.state === "blocked")
      throw new HerdrError(
        "The worker needs attention in Herdr before it can accept another prompt",
        "agent_blocked",
        "prompt",
      );
    await beforeSend?.();
    const result = await command(
      target,
      [
        "agent",
        "prompt",
        existing.paneId!,
        `Task:\n${brief}`,
        "--wait",
        "--until",
        "working",
        "--until",
        "blocked",
        "--timeout",
        "10000",
      ],
      "prompt",
      { mutating: true, timeoutMs: 15_000, signal },
    );
    const worker = workerFrom(result, name, "prompt");
    verifyIdentity(worker, knownIdentity(existing), "prompt");
    if (worker.state !== "working" && worker.state !== "blocked") {
      throw new HerdrError(
        "Herdr did not confirm that the submitted task started; inspect before retrying",
        "prompt_unconfirmed",
        "prompt",
        true,
      );
    }
    return worker;
  }

  async function startCodingWorker(
    target: HerdrTarget,
    options: HerdrStartOptions,
  ): Promise<HerdrWorker> {
    validateTarget(target);
    validateName(options.workerName);
    validateBrief(options.brief);
    if (!options.cwd.startsWith("/") || options.cwd.includes("\0"))
      throw new HerdrError(
        "The worker directory must be an absolute path on its target machine",
        "invalid_cwd",
        "prepare",
      );
    if (!WORKER_KINDS.has(options.workerKind))
      throw new HerdrError(
        "Unsupported Herdr worker kind",
        "invalid_kind",
        "prepare",
      );
    let listing: Record<string, unknown>;
    try {
      listing = await command(target, ["workspace", "list"], "prepare", {
        signal: options.signal,
      });
    } catch (error) {
      if (!(error instanceof HerdrError) || error.code !== "server_not_running")
        throw error;
      await command(target, ["server"], "prepare", {
        detached: true,
        mutating: true,
        signal: options.signal,
      });
      const deadline = Date.now() + 10_000;
      while (true) {
        try {
          listing = await command(target, ["workspace", "list"], "prepare", {
            signal: options.signal,
            timeoutMs: 3000,
          });
          break;
        } catch (error) {
          if (
            !(error instanceof HerdrError) ||
            error.code !== "server_not_running"
          )
            throw error;
          if (Date.now() >= deadline)
            throw new HerdrError(
              "The owned Herdr session did not become ready",
              "startup_timeout",
              "prepare",
              true,
            );
          await delay(200, undefined, { signal: options.signal });
        }
      }
    }
    if (!Array.isArray(listing.workspaces))
      throw new HerdrError(
        "Herdr returned an invalid workspace list",
        "invalid_response",
        "prepare",
      );
    const agents = await command(target, ["agent", "list"], "prepare", {
      signal: options.signal,
    });
    if (!Array.isArray(agents.agents))
      throw new HerdrError(
        "Herdr returned an invalid agent list",
        "invalid_response",
        "prepare",
      );
    if (
      listing.workspaces.some(
        (workspace) => record(workspace).label === options.workerName,
      ) ||
      agents.agents.some((agent) => record(agent).name === options.workerName)
    ) {
      throw new HerdrError(
        "This job already has a Herdr workspace or worker; inspect it instead of launching again",
        "already_exists",
        "prepare",
      );
    }
    const workspace = await command(
      target,
      [
        "workspace",
        "create",
        "--cwd",
        options.cwd,
        "--label",
        options.workerName,
        "--no-focus",
      ],
      "prepare",
      { mutating: true, signal: options.signal },
    );
    const paneId = requiredString(
      record(workspace.root_pane).pane_id,
      "root_pane.pane_id",
      "prepare",
    );
    await options.beforeSend?.();
    const launched = workerFrom(
      await command(
        target,
        [
          "agent",
          "start",
          options.workerName,
          "--kind",
          options.workerKind,
          "--pane",
          paneId,
          "--timeout",
          "30000",
        ],
        "launch",
        { mutating: true, timeoutMs: 40_000, signal: options.signal },
      ),
      options.workerName,
      "launch",
    );
    return promptCodingWorker(
      target,
      options.workerName,
      options.brief,
      knownIdentity(launched),
      options.signal,
      options.beforeSend,
    );
  }

  async function stopCodingWorker(
    target: HerdrTarget,
    name: string,
    expectedIdentity?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const worker = await getWorker(target, name, "stop", signal);
    verifyIdentity(worker, expectedIdentity, "stop");
    await command(
      target,
      ["agent", "send-keys", worker.paneId!, "ctrl+c"],
      "stop",
      { mutating: true, signal },
    );
  }

  return {
    startCodingWorker,
    readCodingWorker,
    promptCodingWorker,
    stopCodingWorker,
  };
}

export const {
  startCodingWorker,
  readCodingWorker,
  promptCodingWorker,
  stopCodingWorker,
} = createHerdrAdapter();
