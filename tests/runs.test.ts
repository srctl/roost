import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { readSoul } from "../src/server/agents/soul.server";
import {
  getAgentConversation,
  saveAgent,
  withAgentStore,
} from "../src/server/agents/store.server";
import {
  deleteAutomation,
  listAutomations,
  saveAutomation,
  toggleAutomation,
} from "../src/server/automations/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import {
  cancelRun,
  claimRun,
  enqueueChat,
  finishRun,
  listRuns,
  persistRun,
  runAutomationNow,
  schedulerTick,
} from "../src/server/runs/store.server";
import { readTimeline } from "../src/server/runs/timeline.server";
import { startWorker } from "../src/server/runs/worker.server";

const run = Effect.runPromise;

const create = (name: string) =>
  run(
    saveAgent({
      id: randomUUID(),
      name,
      instructions: "Help",
      character: "moss",
      model: "fake",
    }),
  );

test("deleting an automation cancels its work atomically and preserves history and other work", async () => {
  const directory = mkdtempSync("/tmp/roost-delete-automation-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agent = await create("Owner");
    const otherAgent = await create("Other");
    const automation = await run(
      saveAutomation({
        id: randomUUID(),
        agentId: agent.id,
        name: "Delete me",
        prompt: "Check updates",
        schedule: { kind: "interval", minutes: 60, timezone: "UTC" },
        notification: "always",
      }),
    );
    const other = await run(
      saveAutomation({ ...automation, id: randomUUID(), name: "Keep me" }),
    );
    await run(schedulerTick("delete-test"));
    const completed = await run(
      runAutomationNow(agent.id, automation.id, randomUUID()),
    );
    const first = (await run(claimRun("delete-test")))!;
    await run(
      finishRun(first, "completed", [
        { id: randomUUID(), role: "assistant", text: "Saved result" },
      ]),
    );
    await run(runAutomationNow(agent.id, automation.id, randomUUID()));
    const active = (await run(claimRun("delete-test")))!;
    const queued = await run(
      runAutomationNow(agent.id, automation.id, randomUUID()),
    );
    const unrelated = await run(
      runAutomationNow(agent.id, other.id, randomUUID()),
    );
    const chat = { agentId: agent.id, messageId: randomUUID(), text: "Hello" };
    await run(enqueueChat(chat));
    const before = await run(listRuns(agent.id));

    await assert.rejects(
      run(deleteAutomation(otherAgent.id, automation.id, automation.revision)),
    );
    await assert.rejects(
      run(deleteAutomation(agent.id, automation.id, automation.revision + 1)),
    );
    await run(
      withAgentStore((db) =>
        db.exec(
          "CREATE TRIGGER fail_delete_notice BEFORE INSERT ON timeline BEGIN SELECT RAISE(ABORT, 'unavailable'); END;",
        ),
      ),
    );
    await assert.rejects(
      run(deleteAutomation(agent.id, automation.id, automation.revision)),
    );
    assert.equal((await run(listAutomations(agent.id))).length, 2);
    assert.deepEqual(await run(listRuns(agent.id)), before);
    await run(
      withAgentStore((db) => db.exec("DROP TRIGGER fail_delete_notice")),
    );

    await run(deleteAutomation(agent.id, automation.id, automation.revision));
    assert.deepEqual(await run(listAutomations(agent.id)), [other]);
    const after = await run(listRuns(agent.id));
    assert.deepEqual(
      after.find((r) => r.id === completed.id),
      before.find((r) => r.id === completed.id),
    );
    assert.equal(after.find((r) => r.id === queued.id)!.status, "cancelled");
    assert.ok(after.find((r) => r.id === queued.id)!.finishedAt);
    assert.equal(after.find((r) => r.id === active.id)!.cancelRequested, 1);
    for (const id of [unrelated.id, chat.messageId])
      assert.deepEqual(
        after.find((r) => r.id === id),
        before.find((r) => r.id === id),
      );
    const timeline = await run(readTimeline(agent.id));
    assert.ok(timeline.some((m) => m.text === "Saved result"));
    assert.equal(timeline.at(-1)!.title, "Automation deleted");
    await assert.rejects(
      run(runAutomationNow(agent.id, automation.id, randomUUID())),
      /not found/,
    );
    await run(schedulerTick("delete-test", Date.now() + 3600001));
    assert.equal(
      (await run(listRuns(agent.id))).filter(
        (r) => r.automationId === automation.id,
      ).length,
      3,
    );
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("timeline failures roll back run changes so queuing and completion can be retried", async () => {
  const directory = mkdtempSync("/tmp/roost-run-rollback-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;

  const failTimelineWrites = () =>
    run(
      withAgentStore((db) =>
        db.exec(`CREATE TRIGGER fail_timeline BEFORE INSERT ON timeline BEGIN
          SELECT RAISE(ABORT, 'Timeline unavailable');
        END;`),
      ),
    );

  const restoreTimelineWrites = () =>
    run(withAgentStore((db) => db.exec("DROP TRIGGER fail_timeline")));

  try {
    const agent = await create("Rollback");
    const input = { agentId: agent.id, messageId: randomUUID(), text: "Hello" };
    await failTimelineWrites();
    await assert.rejects(
      run(enqueueChat(input)),
      /Could not access agent storage/,
    );
    assert.deepEqual(await run(listRuns(agent.id)), []);
    assert.deepEqual(await run(readTimeline(agent.id)), []);

    await restoreTimelineWrites();
    await run(enqueueChat(input));
    await run(schedulerTick("worker"));
    const active = (await run(claimRun("worker")))!;
    const messages = [
      { id: randomUUID(), role: "assistant" as const, text: "Done" },
    ];
    await failTimelineWrites();
    await assert.rejects(
      run(finishRun(active, "completed", messages)),
      /Could not access agent storage/,
    );
    assert.deepEqual((await run(listRuns(agent.id)))[0], active);
    assert.equal((await run(readTimeline(agent.id))).length, 1);

    await restoreTimelineWrites();
    await run(finishRun(active, "completed", messages));
    assert.equal((await run(listRuns(agent.id)))[0]!.status, "completed");
    assert.deepEqual((await run(readTimeline(agent.id))).at(-1), messages[0]);
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded cron schedules persist, queue once, and expire without a late catch-up", async () => {
  const directory = mkdtempSync("/tmp/roost-cron-");
  const oldDirectory = process.env.ROOST_DATA_DIR;
  const clock = Date.now;
  let now = Date.parse("2026-09-06T06:00:00Z");
  process.env.ROOST_DATA_DIR = directory;
  Date.now = () => now;
  try {
    const agent = await create("Delivery monitor");
    const automation = await run(
      saveAutomation({
        agentId: agent.id,
        id: randomUUID(),
        name: "Check delivery",
        prompt: "Check status",
        schedule: {
          kind: "cron",
          expression: "0 8-22/2 * * *",
          timezone: "America/Los_Angeles",
          startsOn: "2026-09-06",
          endsOn: "2026-09-06",
        },
        notification: "when-needed",
      }),
    );
    assert.deepEqual(
      (await run(listAutomations(agent.id)))[0]!.schedule,
      automation.schedule,
    );
    await run(schedulerTick("cron"));
    assert.equal((await run(listRuns(agent.id))).length, 0);
    now = Date.parse("2026-09-06T15:00:00Z");
    await run(schedulerTick("cron"));
    await run(schedulerTick("cron"));
    const running = await run(claimRun("cron"));
    assert.equal(running?.scheduledFor, now);
    now = Date.parse("2026-09-06T17:00:00Z");
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE worker_lease SET heartbeat=?").run(now),
      ),
    );
    await run(schedulerTick("cron"));
    const manual = await run(
      runAutomationNow(agent.id, automation.id, randomUUID()),
    );
    now = Date.parse("2026-09-07T07:00:00Z");
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE worker_lease SET heartbeat=?").run(now),
      ),
    );
    await run(schedulerTick("cron"));
    const expired = (await run(listAutomations(agent.id)))[0]!;
    assert.equal(expired.enabled, false);
    assert.equal(expired.nextRunAt, null);
    const runs = await run(listRuns(agent.id));
    assert.equal(runs.length, 3);
    assert.equal(runs.find((r) => r.id === running!.id)!.status, "running");
    assert.equal(runs.find((r) => r.id === manual.id)!.status, "queued");
    assert.equal(
      runs.find((r) => r.scheduledFor === Date.parse("2026-09-06T17:00:00Z"))!
        .status,
      "cancelled",
    );
    await assert.rejects(
      run(toggleAutomation(agent.id, automation.id, expired.revision, true)),
      /future runs/,
    );
    const edited = await run(
      saveAutomation(
        {
          ...expired,
          schedule: { ...automation.schedule, endsOn: "2026-09-08" },
        },
        expired.revision,
      ),
    );
    await run(toggleAutomation(agent.id, automation.id, edited.revision, true));
    assert.ok((await run(listAutomations(agent.id)))[0]!.nextRunAt! > now);
  } finally {
    Date.now = clock;
    if (oldDirectory === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = oldDirectory;
    rmSync(directory, { recursive: true, force: true });
  }
});

async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for run");
}

test("durable queue serializes each agent, deduplicates requests, catches up once, and never replays interrupted work", async () => {
  const directory = mkdtempSync("/tmp/roost-runs-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const a = await create("A"),
      b = await create("B");
    const input = { agentId: a.id, messageId: randomUUID(), text: "Hello" };
    await run(enqueueChat(input));
    await run(enqueueChat(input));
    await assert.rejects(
      run(enqueueChat({ ...input, text: "Different" })),
      /already been used/,
    );
    await run(enqueueChat({ ...input, messageId: randomUUID(), text: "Next" }));
    await run(
      enqueueChat({ agentId: b.id, messageId: randomUUID(), text: "Other" }),
    );
    assert.equal(await run(schedulerTick("first")), true);
    const first = await run(claimRun("first")),
      other = await run(claimRun("first"));
    await run(
      persistRun(first!, [
        {
          id: "active-tool",
          role: "activity",
          title: "Reading",
          text: "partial",
          status: "inProgress",
        },
      ]),
    );
    assert.equal(first?.agentId, a.id);
    assert.equal(other?.agentId, b.id);
    assert.equal(await run(claimRun("first")), undefined);
    assert.equal(await run(schedulerTick("second")), false);
    assert.equal(await run(claimRun("second")), undefined);
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE worker_lease SET heartbeat=0").run(),
      ),
    );
    await run(schedulerTick("second"));
    assert.equal(
      (await run(listRuns(a.id))).find((r) => r.id === first!.id)?.status,
      "interrupted",
    );
    await run(
      finishRun(first!, "completed", [
        { id: "late", role: "assistant", text: "Must not publish" },
      ]),
    );
    assert.ok(!(await run(readTimeline(a.id))).some((m) => m.id === "late"));
    assert.equal(
      (await run(readTimeline(a.id))).find((m) => m.id === "active-tool")
        ?.status,
      "interrupted",
    );
    const queued = await run(claimRun("second"));
    assert.equal(queued?.prompt, "Next");
    await run(finishRun(queued!, "completed", []));
    const automation = await run(
      saveAutomation({
        agentId: a.id,
        id: randomUUID(),
        name: "Check",
        prompt: "quiet",
        schedule: { kind: "interval", minutes: 60 },
        notification: "when-needed",
      }),
    );
    assert.equal(
      (await run(saveAutomation(automation))).revision,
      automation.revision,
    );
    await assert.rejects(
      run(saveAutomation({ ...automation, agentId: b.id })),
      /already been used/,
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE automations SET nextRunAt=? WHERE id=?")
          .run(Date.now() - 10 * 3600000, automation.id),
      ),
    );
    await run(schedulerTick("second"));
    await run(schedulerTick("second"));
    const automated = (await run(listRuns(a.id))).filter(
      (r) => r.kind === "automation",
    );
    assert.equal(automated.length, 1);
    assert.ok((await run(listAutomations(a.id)))[0]!.nextRunAt! > Date.now());
    const quiet = await run(claimRun("second"));
    await run(
      finishRun(quiet!, "completed", [
        { id: "quiet", role: "assistant", text: "ROOST_NO_UPDATE" },
      ]),
    );
    assert.ok(
      !(await run(readTimeline(a.id))).some(
        (m) => m.id === `result:${quiet!.id}`,
      ),
    );
    const requestId = randomUUID();
    await run(runAutomationNow(a.id, automation.id, requestId));
    await run(runAutomationNow(a.id, automation.id, requestId));
    assert.equal(
      (await run(listRuns(a.id))).filter((r) => r.id === requestId).length,
      1,
    );
    await run(
      toggleAutomation(a.id, automation.id, automation.revision, false),
    );
    assert.equal(
      (await run(listRuns(a.id))).find((r) => r.id === requestId)?.status,
      "cancelled",
    );
    await assert.rejects(
      run(toggleAutomation(a.id, automation.id, automation.revision, true)),
      /changed/,
    );
    await run(runAutomationNow(a.id, automation.id, randomUUID()));
    const report = await run(claimRun("second"));
    await run(
      finishRun(report!, "completed", [
        { id: "report", role: "assistant", text: "Something needs attention." },
      ]),
    );
    assert.ok(
      (await run(readTimeline(a.id))).some(
        (m) => m.id === `result:${report!.id}` && m.title === "Check",
      ),
    );
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("worker runs without an HTTP subscriber, supports explicit stop, and isolates scheduled threads and mutation tools", async () => {
  const directory = mkdtempSync("/tmp/roost-worker-");
  const old = {
    data: process.env.ROOST_DATA_DIR,
    home: process.env.CODEX_HOME,
    binary: process.env.ROOST_CODEX_BINARY,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.CODEX_HOME = directory;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  let stop: (() => Promise<void>) | undefined;
  try {
    const a = await create("A");
    const first = randomUUID();
    await run(
      enqueueChat({ agentId: a.id, messageId: first, text: "delayed" }),
    );
    stop = startWorker();
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === first)?.status ===
        "completed",
    );
    assert.ok(
      (await run(readTimeline(a.id))).some((m) => m.text === "Hello there."),
    );
    const original = await run(getAgentConversation(a.id));
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE agent_tool_versions SET version=3 WHERE threadId=?")
          .run(original.threadId!),
      ),
    );
    const soul = await run(readSoul(a.id));
    const automation = await run(
      saveAutomation({
        agentId: a.id,
        id: randomUUID(),
        name: "Check soul",
        prompt: "soul",
        schedule: { kind: "interval", minutes: 60 },
        notification: "always",
      }),
    );
    const automatic = randomUUID();
    await run(runAutomationNow(a.id, automation.id, automatic));
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === automatic)?.status ===
        "completed",
    );
    const automated = (await run(listRuns(a.id))).find(
      (r) => r.id === automatic,
    )!;
    assert.notEqual(automated.threadId, original.threadId);
    assert.equal(
      (await run(getAgentConversation(a.id))).threadId,
      original.threadId,
    );
    assert.equal((await run(readSoul(a.id))).revision, soul.revision);
    assert.ok(
      (await run(readTimeline(a.id))).some((m) => m.title === "Check soul"),
    );
    const slow = randomUUID();
    await run(enqueueChat({ agentId: a.id, messageId: slow, text: "slow" }));
    await until(
      async () =>
        !!(await run(listRuns(a.id))).find((r) => r.id === slow)?.threadId,
    );
    await run(cancelRun(a.id, slow));
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === slow)?.status ===
        "cancelled",
    );
    const next = randomUUID();
    await run(
      enqueueChat({ agentId: a.id, messageId: next, text: "Continue" }),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === next)?.status ===
        "completed",
    );
    const migrated = await run(getAgentConversation(a.id));
    assert.notEqual(migrated.threadId, original.threadId);
    assert.equal(migrated.toolVersion, 14);
    assert.ok(
      JSON.parse(migrated.archive).some(
        (m: { text: string }) => m.text === "delayed",
      ),
    );
    const native = JSON.parse(
      readFileSync(
        join(
          directory,
          "agents",
          a.id,
          "codex",
          `fake-${migrated.threadId}.json`,
        ),
        "utf8",
      ),
    );
    assert.ok(
      native.options.dynamicTools.some(
        (tool: { name: string }) => tool.name === "roost_computer",
      ),
    );
    assert.ok(
      native.instructionUpdates.some((m: { content: { text: string }[] }) =>
        m.content[0]!.text.includes("Check soul"),
      ),
    );
  } finally {
    await stop?.();
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries({
      ROOST_DATA_DIR: old.data,
      CODEX_HOME: old.home,
      ROOST_CODEX_BINARY: old.binary,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dynamic delegation runs a specialist independently and wakes the parent's existing conversation", async () => {
  const directory = mkdtempSync("/tmp/roost-agent-team-");
  const old = {
    data: process.env.ROOST_DATA_DIR,
    home: process.env.CODEX_HOME,
    binary: process.env.ROOST_CODEX_BINARY,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.CODEX_HOME = directory;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  let stop: (() => Promise<void>) | undefined;
  try {
    const guy = await create("Guy"),
      shopping = await create("Shopping");
    const id = randomUUID();
    await run(
      enqueueChat({
        agentId: guy.id,
        messageId: id,
        text: `delegate:${shopping.id}`,
      }),
    );
    stop = startWorker();
    await until(
      async () =>
        (await run(listRuns(guy.id))).find((r) => r.id === id)?.status ===
        "completed",
    );
    const parent = await run(getAgentConversation(guy.id));
    const question = randomUUID();
    await run(
      enqueueChat({
        agentId: guy.id,
        messageId: question,
        text: "Another question",
      }),
    );
    await until(
      async () =>
        (await run(listRuns(guy.id))).find((r) => r.id === question)?.status ===
        "completed",
    );
    assert.equal((await run(listRuns(shopping.id)))[0]!.status, "running");
    await until(async () =>
      (await run(listRuns(guy.id))).some(
        (r) => r.kind === "handoff" && r.status === "completed",
      ),
    );
    const child = (await run(listRuns(shopping.id)))[0]!;
    assert.equal(child.status, "completed");
    assert.equal((await run(getAgentConversation(shopping.id))).threadId, null);
    assert.equal(
      (await run(getAgentConversation(guy.id))).threadId,
      parent.threadId,
    );
    const childNative = JSON.parse(
      readFileSync(
        join(
          directory,
          "agents",
          shopping.id,
          "codex",
          `fake-${child.threadId}.json`,
        ),
        "utf8",
      ),
    );
    assert.match(childNative.options.developerInstructions, /delegated task/);
    assert.equal(childNative.turns.length, 1);
    const timeline = await run(readTimeline(shopping.id));
    assert.equal(timeline.find((m) => m.id === child.id)?.role, "notice");
    assert.ok(
      timeline.some(
        (m) => m.text === "Specialist finished. Nothing purchased.",
      ),
    );
    const returns = (await run(listRuns(guy.id))).filter(
      (r) => r.kind === "handoff",
    );
    assert.equal(returns.length, 1);
    assert.equal(returns[0]!.threadId, parent.threadId);
    assert.equal(
      (await run(readTimeline(guy.id))).find((m) => m.id === returns[0]!.id)
        ?.role,
      "notice",
    );
  } finally {
    await stop?.();
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries({
      ROOST_DATA_DIR: old.data,
      CODEX_HOME: old.home,
      ROOST_CODEX_BINARY: old.binary,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("background work reserves capacity for user conversations", async () => {
  const directory = mkdtempSync("/tmp/roost-reserved-chat-");
  const old = {
    data: process.env.ROOST_DATA_DIR,
    home: process.env.CODEX_HOME,
    binary: process.env.ROOST_CODEX_BINARY,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.CODEX_HOME = directory;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  let stop: (() => Promise<void>) | undefined;
  try {
    const guy = await create("Guy");
    const specialists = [];
    for (let i = 0; i < 4; i++) {
      const agent = await create(`Specialist ${i}`);
      specialists.push(agent);
      const automation = await run(
        saveAutomation({
          agentId: agent.id,
          id: randomUUID(),
          name: "Work",
          prompt: "slow",
          schedule: { kind: "interval", minutes: 60 },
          notification: "always",
        }),
      );
      await run(runAutomationNow(agent.id, automation.id, randomUUID()));
    }
    stop = startWorker();
    await until(
      async () =>
        (
          await run(
            withAgentStore((db) =>
              db
                .prepare(
                  "SELECT count(*) AS count FROM runs WHERE status='running'",
                )
                .get(),
            ),
          )
        )?.count === 3,
    );
    const chat = randomUUID();
    await run(
      enqueueChat({
        agentId: guy.id,
        messageId: chat,
        text: "Still available?",
      }),
    );
    await until(
      async () =>
        (await run(listRuns(guy.id))).find((r) => r.id === chat)?.status ===
        "completed",
    );
    const background = await Promise.all(
      specialists.map((a) => run(listRuns(a.id))),
    );
    assert.equal(
      background.flat().filter((r) => r.status === "running").length,
      3,
    );
    assert.equal(
      background.flat().filter((r) => r.status === "queued").length,
      1,
    );
  } finally {
    await stop?.();
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries({
      ROOST_DATA_DIR: old.data,
      CODEX_HOME: old.home,
      ROOST_CODEX_BINARY: old.binary,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
