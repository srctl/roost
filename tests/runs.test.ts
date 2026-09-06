import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { Effect } from "effect";
import {
  saveAgent,
  withAgentStore,
  getAgentConversation,
} from "../src/server/agents/store.server";
import {
  saveAutomation,
  toggleAutomation,
  listAutomations,
} from "../src/server/automations/store.server";
import {
  enqueueChat,
  schedulerTick,
  claimRun,
  listRuns,
  finishRun,
  persistRun,
  runAutomationNow,
  cancelRun,
} from "../src/server/runs/store.server";
import { readTimeline } from "../src/server/runs/timeline.server";
import { startWorker } from "../src/server/runs/worker.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { readSoul } from "../src/server/agents/soul.server";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
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
    let automated = (await run(listRuns(a.id))).filter(
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
    assert.equal(migrated.toolVersion, 4);
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
