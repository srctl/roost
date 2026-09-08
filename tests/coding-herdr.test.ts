import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  createHerdrAdapter,
  type HerdrCommand,
  type HerdrCommandRunner,
  HerdrError,
} from "../src/server/coding/herdr.server";

const target = { sessionName: "roost-job-123", remoteTarget: "" };
const name = "roost-worker-123";
const options = {
  cwd: "/work/project with spaces",
  workerKind: "codex",
  workerName: name,
  brief: "Implement the requested change and run the relevant checks.",
};

function agent(state = "idle", terminal = "terminal-1") {
  return {
    name,
    agent: "codex",
    agent_status: state,
    terminal_id: terminal,
    pane_id: "pane-1",
    workspace_id: "workspace-1",
  };
}

function reply(result: unknown) {
  return { stdout: JSON.stringify({ id: "cli:test", result }), stderr: "" };
}

function mock(steps: Array<ReturnType<typeof reply> | Error>) {
  const commands: HerdrCommand[] = [];
  const runner: HerdrCommandRunner = async (command) => {
    commands.push(command);
    const step = steps.shift();
    assert.ok(step, `Unexpected command ${command.args.join(" ")}`);
    if (step instanceof Error) throw step;
    return step;
  };
  return { ...createHerdrAdapter(runner), commands, steps };
}

function serverError(code: string) {
  return Object.assign(new Error("CLI error"), {
    code: 1,
    stderr: JSON.stringify({ error: { code, message: code } }),
  });
}

function startup() {
  return [
    reply({ type: "workspace_list", workspaces: [] }),
    reply({ type: "agent_list", agents: [] }),
    reply({ type: "workspace_created", root_pane: { pane_id: "pane-1" } }),
    reply({ type: "agent_started", agent: agent() }),
    reply({ type: "agent_info", agent: agent() }),
    reply({ type: "agent_prompted", agent: agent("working") }),
  ];
}

test("starts a named worker without focusing and confirms activity after submission", async () => {
  const adapter = mock(startup());
  const worker = await adapter.startCodingWorker(target, options);
  assert.equal(worker.state, "working");
  assert.equal(worker.sessionIdentity, "terminal:terminal-1");
  assert.equal(worker.workspaceId, "workspace-1");
  assert.equal(adapter.steps.length, 0);
  for (const command of adapter.commands) {
    assert.deepEqual(command.args.slice(0, 2), [
      "--session",
      target.sessionName,
    ]);
    assert.ok(command.timeoutMs <= 40_000);
  }
  assert.deepEqual(adapter.commands[2]?.args.slice(2), [
    "workspace",
    "create",
    "--cwd",
    options.cwd,
    "--label",
    name,
    "--no-focus",
  ]);
  assert.deepEqual(adapter.commands.at(-1)?.args.slice(2), [
    "agent",
    "prompt",
    "pane-1",
    `Task:\n${options.brief}`,
    "--wait",
    "--until",
    "working",
    "--until",
    "blocked",
    "--timeout",
    "10000",
  ]);
});

test("starts an owned headless server only for explicit server_not_running", async () => {
  const adapter = mock([
    serverError("server_not_running"),
    { stdout: "", stderr: "" },
    ...startup(),
  ]);
  await adapter.startCodingWorker(target, options);
  assert.equal(adapter.commands[1]?.detached, true);
  assert.deepEqual(adapter.commands[1]?.args, [
    "--session",
    target.sessionName,
    "server",
  ]);

  const denied = mock([serverError("permission_denied")]);
  await assert.rejects(denied.startCodingWorker(target, options), {
    code: "permission_denied",
  });
  assert.equal(denied.commands.length, 1);
});

test("existing job workspace or worker prevents duplicate launches and prompt delivery", async () => {
  for (const kind of ["workspace", "worker"]) {
    const adapter = mock([
      reply({
        type: "workspace_list",
        workspaces: kind === "workspace" ? [{ label: name }] : [],
      }),
      reply({
        type: "agent_list",
        agents: kind === "worker" ? [agent("working")] : [],
      }),
    ]);
    await assert.rejects(adapter.startCodingWorker(target, options), {
      code: "already_exists",
    });
    assert.equal(adapter.commands.length, 2);
  }
});

test("uncertain prompt timeout is preserved without retrying or marking the initial idle state complete", async () => {
  const steps = startup();
  steps.pop();
  const adapter = mock([...steps, serverError("timeout")]);
  await assert.rejects(adapter.startCodingWorker(target, options), (error) => {
    assert.ok(error instanceof HerdrError);
    assert.equal(error.code, "timeout");
    assert.equal(error.stage, "prompt");
    assert.equal(error.uncertain, true);
    return true;
  });
  assert.equal(
    adapter.commands.filter((command) => command.args[3] === "prompt").length,
    1,
  );

  const idle = mock([
    reply({ type: "agent_info", agent: agent() }),
    reply({ type: "agent_prompted", agent: agent() }),
  ]);
  await assert.rejects(idle.promptCodingWorker(target, name, "Continue"), {
    code: "prompt_unconfirmed",
    uncertain: true,
  });
});

test("dispatch guards prevent launch or prompt after cancellation or lease loss", async () => {
  const cancel = async () => {
    throw new HerdrError(
      "The job was stopped before submission.",
      "cancelled",
      "prompt",
    );
  };
  const beforeLaunch = mock(startup().slice(0, 3));
  await assert.rejects(
    beforeLaunch.startCodingWorker(target, { ...options, beforeSend: cancel }),
    { code: "cancelled", uncertain: false },
  );
  assert.equal(beforeLaunch.commands.length, 3);

  let checks = 0;
  const beforePrompt = mock(startup().slice(0, 5));
  await assert.rejects(
    beforePrompt.startCodingWorker(target, {
      ...options,
      beforeSend: async () => {
        if (++checks === 2) await cancel();
      },
    }),
    { code: "cancelled", uncertain: false },
  );
  assert.equal(checks, 2);
  assert.equal(beforePrompt.commands.length, 5);
  assert.equal(
    beforePrompt.commands.some((command) => command.args[3] === "prompt"),
    false,
  );

  const continuation = mock([reply({ type: "agent_info", agent: agent() })]);
  await assert.rejects(
    continuation.promptCodingWorker(
      target,
      name,
      "Continue",
      undefined,
      undefined,
      cancel,
    ),
    { code: "cancelled", uncertain: false },
  );
  assert.equal(continuation.commands.length, 1);
});

test("reads terminal text, preserves idle, and validates ownership before and after the read", async () => {
  const adapter = mock([
    reply({ type: "agent_info", agent: agent("idle") }),
    { stdout: "Finished implementation. Two checks passed.", stderr: "" },
    reply({
      type: "agent_info",
      agent: { ...agent("idle"), agent_session: { value: "native-session-1" } },
    }),
  ]);
  const worker = await adapter.readCodingWorker(target, name);
  assert.equal(worker.state, "idle");
  assert.equal(worker.output, "Finished implementation. Two checks passed.");
  assert.equal(worker.nativeSessionId, "native-session-1");
  assert.equal(worker.sessionIdentity, "terminal:terminal-1");

  const changed = mock([
    reply({ type: "agent_info", agent: agent() }),
    { stdout: "Unrelated output", stderr: "" },
    reply({ type: "agent_info", agent: agent("working", "other-terminal") }),
  ]);
  await assert.rejects(changed.readCodingWorker(target, name), {
    code: "identity_changed",
  });
});

test("missing worker and unavailable transport remain distinct", async () => {
  const missing = mock([serverError("agent_name_not_found")]);
  assert.deepEqual(await missing.readCodingWorker(target, name), {
    state: "missing",
    output: "",
    sessionIdentity: null,
  });
  const unavailable = mock([
    Object.assign(new Error("SSH failed"), { code: 255 }),
  ]);
  await assert.rejects(unavailable.readCodingWorker(target, name), {
    code: "255",
  });
});

test("continuation rejects busy, blocked, and replaced workers before delivering input", async () => {
  for (const state of ["working", "unknown", "blocked"]) {
    const adapter = mock([reply({ type: "agent_info", agent: agent(state) })]);
    await assert.rejects(adapter.promptCodingWorker(target, name, "Continue"));
    assert.equal(adapter.commands.length, 1);
  }
  const replaced = mock([reply({ type: "agent_info", agent: agent() })]);
  await assert.rejects(
    replaced.promptCodingWorker(target, name, "Continue", "terminal:other"),
    { code: "identity_changed" },
  );
  assert.equal(replaced.commands.length, 1);
});

test("stopping sends ctrl+c only to the verified worker pane and keeps its server", async () => {
  const adapter = mock([
    reply({ type: "agent_info", agent: agent("working") }),
    reply({ type: "ok" }),
  ]);
  await adapter.stopCodingWorker(target, name, "terminal:terminal-1");
  assert.deepEqual(adapter.commands[1]?.args, [
    "--session",
    target.sessionName,
    "agent",
    "send-keys",
    "pane-1",
    "ctrl+c",
  ]);
  const replaced = mock([reply({ type: "agent_info", agent: agent() })]);
  await assert.rejects(
    replaced.stopCodingWorker(target, name, "terminal:other"),
    { code: "identity_changed" },
  );
  assert.equal(replaced.commands.length, 1);
});

test("replacing the native coding session in the same terminal prevents input", async () => {
  const replacement = {
    ...agent(),
    agent_session: { value: "replacement-native-session" },
  };
  const expected = "terminal:terminal-1|session:original-native-session";
  const prompt = mock([reply({ type: "agent_info", agent: replacement })]);
  await assert.rejects(
    prompt.promptCodingWorker(target, name, "Continue", expected),
    { code: "identity_changed" },
  );
  assert.equal(prompt.commands.length, 1);
  const stop = mock([reply({ type: "agent_info", agent: replacement })]);
  await assert.rejects(stop.stopCodingWorker(target, name, expected), {
    code: "identity_changed",
  });
  assert.equal(stop.commands.length, 1);

  const output = mock([
    reply({
      type: "agent_info",
      agent: {
        ...agent(),
        agent_session: { value: "original-native-session" },
      },
    }),
    { stdout: "Unrelated work", stderr: "" },
    reply({ type: "agent_info", agent: replacement }),
  ]);
  await assert.rejects(output.readCodingWorker(target, name), {
    code: "identity_changed",
  });
});

test("remote execution quotes every argument and rejects SSH option or shell injection", async () => {
  const brief =
    "Update O'Reilly's page; $(touch /tmp/nope) `whoami`\n--session default";
  const adapter = mock([
    reply({ type: "agent_info", agent: agent() }),
    reply({ type: "agent_prompted", agent: agent("working") }),
  ]);
  await adapter.promptCodingWorker(
    { ...target, remoteTarget: "dev@workbox" },
    name,
    brief,
  );
  const command = adapter.commands[1]!;
  assert.equal(command.file, "ssh");
  assert.deepEqual(command.args.slice(0, 7), [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "--",
    "dev@workbox",
    command.args[6],
  ]);
  assert.ok(
    command.args[6]!.includes(
      "'Task:\nUpdate O'\\''Reilly'\\''s page; $(touch /tmp/nope) `whoami`\n--session default'",
    ),
  );
  for (const remoteTarget of [
    "-oProxyCommand=touch",
    "host;whoami",
    "host extra",
    "host\nwhoami",
    "user@host:22",
  ]) {
    const denied = mock([]);
    await assert.rejects(
      denied.readCodingWorker({ ...target, remoteTarget }, name),
      { code: "invalid_target" },
    );
    assert.equal(denied.commands.length, 0);
  }
});

test("invalid owned names, unsafe paths, kinds and briefs fail before any command", async () => {
  const adapter = mock([]);
  await assert.rejects(
    adapter.startCodingWorker({ ...target, sessionName: "default" }, options),
    { code: "invalid_target" },
  );
  await assert.rejects(
    adapter.startCodingWorker(target, {
      ...options,
      workerName: "someone-elses-worker",
    }),
    { code: "invalid_target" },
  );
  await assert.rejects(
    adapter.startCodingWorker(target, {
      ...options,
      workerName: `roost-${"a".repeat(27)}`,
    }),
    { code: "invalid_target" },
  );
  await assert.rejects(
    adapter.startCodingWorker(target, { ...options, cwd: "~/project" }),
    { code: "invalid_cwd" },
  );
  await assert.rejects(
    adapter.startCodingWorker(target, {
      ...options,
      workerKind: "sh -c whoami",
    }),
    { code: "invalid_kind" },
  );
  await assert.rejects(
    adapter.startCodingWorker(target, { ...options, brief: "unsafe\0text" }),
    { code: "invalid_brief" },
  );
  assert.equal(adapter.commands.length, 0);
});

test("default command runner uses its binary override and removes coordinator session environment", async () => {
  const directory = mkdtempSync("/tmp/roost-herdr-runner-");
  const fixture = join(directory, "fake-herdr.mjs");
  writeFileSync(
    fixture,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[2] !== 'agent' || !['get','read'].includes(args[3])) process.exit(99);
if (args[3] === 'read') console.log(JSON.stringify({codexHome:process.env.CODEX_HOME,sqliteHome:process.env.CODEX_SQLITE_HOME,accessToken:process.env.CODEX_ACCESS_TOKEN,herdrSocket:process.env.HERDR_SOCKET_PATH,runId:process.env.ROOST_RUN_ID}));
else console.log(JSON.stringify({result:{type:'agent_info',agent:${JSON.stringify(agent())}}}));
`,
    { mode: 0o755 },
  );
  const keys = [
    "ROOST_HERDR_BINARY",
    "CODEX_HOME",
    "CODEX_SQLITE_HOME",
    "CODEX_ACCESS_TOKEN",
    "HERDR_SOCKET_PATH",
    "ROOST_RUN_ID",
  ];
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.ROOST_HERDR_BINARY = fixture;
    process.env.CODEX_HOME = "/private/agent-home";
    process.env.CODEX_SQLITE_HOME = "/private/agent-sqlite";
    process.env.CODEX_ACCESS_TOKEN = "fixture-token";
    process.env.HERDR_SOCKET_PATH = "/focused/user-session.sock";
    process.env.ROOST_RUN_ID = "private-run";
    const worker = await createHerdrAdapter().readCodingWorker(target, name);
    assert.deepEqual(JSON.parse(worker.output), {});
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    rmSync(directory, { recursive: true, force: true });
  }
});
