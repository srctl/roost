import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { listSoulChanges, readSoul } from "../src/server/agents/soul.server";
import {
  getAgentConversation,
  saveAgent,
  withAgentStore,
} from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { handleAgentTool } from "../src/server/codex/agent-tools.server";
import { runNotificationKind } from "../src/server/notifications/push.server";
import {
  readReflection,
  reflectionContext,
  runReflectionNow,
  saveReflection,
} from "../src/server/reflections/store.server";
import {
  claimRun,
  enqueueChat,
  finishRun,
  listRuns,
  persistRun,
  schedulerTick,
} from "../src/server/runs/store.server";
import { putMessage, readTimeline } from "../src/server/runs/timeline.server";
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

async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("Timed out waiting for reflection");
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

test("reflection cadence skips unchanged and busy agents, coalesces downtime, and stays quiet", async () => {
  const directory = mkdtempSync("/tmp/roost-reflections-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const a = await create("A"),
      b = await create("B");
    const now = Date.now();
    assert.equal((await run(readReflection(a.id))).intervalMinutes, 360);
    await run(
      saveReflection({ agentId: a.id, intervalMinutes: 60 }, now - 7200000),
    );
    await run(schedulerTick("owner", now));
    assert.equal((await run(listRuns(a.id))).length, 0);
    await run(
      enqueueChat({
        agentId: a.id,
        messageId: randomUUID(),
        text: "Keep answers brief",
      }),
    );
    const chat = (await run(claimRun("owner")))!;
    await run(
      saveReflection({ agentId: a.id, intervalMinutes: 60 }, now - 7200000),
    );
    await run(schedulerTick("owner"));
    assert.equal((await run(listRuns(a.id))).length, 1);
    await run(
      finishRun(chat, "completed", [
        { id: randomUUID(), role: "assistant", text: "Understood" },
      ]),
    );
    await run(schedulerTick("owner"));
    await run(schedulerTick("owner"));
    const reflection = (await run(listRuns(a.id))).find(
      (r) => r.kind === "reflection",
    )!;
    assert.ok(reflection);
    assert.equal((await run(listRuns(b.id))).length, 0);
    assert.ok((await run(readReflection(a.id))).nextRunAt! > now);
    assert.equal(
      (await run(runReflectionNow(a.id, randomUUID()))).id,
      reflection.id,
    );
    await assert.rejects(
      run(runReflectionNow(b.id, reflection.id)),
      /already been used/,
    );
    // User chat takes priority even when reflection was queued first.
    await run(
      enqueueChat({
        agentId: a.id,
        messageId: randomUUID(),
        text: "New message",
      }),
    );
    const priority = (await run(claimRun("owner")))!;
    assert.equal(priority.kind, "chat");
    await run(finishRun(priority, "completed", []));
    const active = (await run(claimRun("owner")))!;
    const quiet = [
      { id: randomUUID(), role: "assistant" as const, text: "ROOST_NO_UPDATE" },
    ];
    const before = await run(readTimeline(a.id));
    await run(persistRun(active, quiet));
    assert.deepEqual(await run(readTimeline(a.id)), before);
    await run(finishRun(active, "completed", quiet));
    assert.deepEqual(await run(readTimeline(a.id)), before);
    assert.equal(
      runNotificationKind({
        ...active,
        status: "completed",
        messages: JSON.stringify(quiet),
      }),
      null,
    );
    // Reflection output never triggers another reflection without fresh activity.
    await run(
      saveReflection({ agentId: a.id, intervalMinutes: 60 }, now - 7200000),
    );
    await run(schedulerTick("owner"));
    assert.equal(
      (await run(listRuns(a.id))).filter((r) => r.kind === "reflection").length,
      1,
    );
    // Manual reflection works while periodic reflection is off and is idempotent.
    await run(saveReflection({ agentId: a.id, intervalMinutes: 0 }));
    const manualId = randomUUID();
    await run(runReflectionNow(a.id, manualId));
    await run(runReflectionNow(a.id, manualId));
    assert.equal(
      (await run(listRuns(a.id))).filter((r) => r.id === manualId).length,
      1,
    );
    assert.equal((await run(readReflection(a.id))).nextRunAt, null);
    const interrupted = (await run(claimRun("owner")))!;
    await run(
      persistRun(interrupted, [
        {
          id: "private-reflection",
          role: "activity",
          text: "partial",
          status: "inProgress",
        },
      ]),
    );
    await run(schedulerTick("replacement", Date.now() + 31000));
    assert.equal(
      (await run(listRuns(a.id))).find((r) => r.id === manualId)?.status,
      "interrupted",
    );
    assert.ok(
      !(await run(readTimeline(a.id))).some(
        (m) => m.id === "private-reflection",
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reflection uses bounded own-agent context and restricts tools to audited soul edits", async () => {
  const directory = mkdtempSync("/tmp/roost-reflection-worker-");
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    ROOST_CODEX_BINARY: process.env.ROOST_CODEX_BINARY,
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
    const a = await create("A"),
      b = await create("B");
    await run(
      withAgentStore((db) => {
        putMessage(db, a.id, {
          id: randomUUID(),
          role: "user",
          text: "Please keep answers brief",
        });
        putMessage(db, a.id, {
          id: randomUUID(),
          role: "activity",
          text: "TOOL_PAYLOAD",
        });
        putMessage(db, b.id, {
          id: randomUUID(),
          role: "user",
          text: "OTHER_AGENT",
        });
        for (let i = 0; i < 80; i++)
          putMessage(db, a.id, {
            id: randomUUID(),
            role: "assistant",
            text: "x".repeat(1000),
          });
      }),
    );
    const context = await run(reflectionContext(a.id));
    assert.ok(context.length <= 24000);
    assert.ok(
      !context.includes("TOOL_PAYLOAD") && !context.includes("OTHER_AGENT"),
    );
    const soul = await run(readSoul(a.id));
    for (const tool of [
      "roost_save_automation",
      "roost_delegate_task",
      "roost_notify",
      "roost_save_dashboard",
    ]) {
      const denied = await handleAgentTool(
        { agentId: a.id, allowMutations: "reflection" },
        tool,
        {},
      );
      assert.equal(denied.success, false);
    }
    const queued = await run(runReflectionNow(a.id, randomUUID()));
    // Fixture exercises real read/update tool requests through the bound runtime.
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET prompt='soul' WHERE id=?").run(queued.id),
      ),
    );
    stop = startWorker();
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === queued.id)?.status ===
        "completed",
    );
    const completed = (await run(listRuns(a.id))).find(
      (r) => r.id === queued.id,
    )!;
    assert.notEqual((await run(readSoul(a.id))).revision, soul.revision);
    assert.equal((await run(listSoulChanges(a.id)))[0]?.source, "reflection");
    assert.equal((await run(getAgentConversation(a.id))).threadId, null);
    const native = JSON.parse(
      readFileSync(
        join(
          directory,
          "agents",
          a.id,
          "codex",
          `fake-${completed.threadId}.json`,
        ),
        "utf8",
      ),
    );
    assert.equal(native.options.sandbox, "read-only");
    assert.equal(native.options.approvalPolicy, "never");
    assert.equal(native.options.config["features.apps"], false);
    assert.deepEqual(
      native.options.dynamicTools.map((t: { name: string }) => t.name),
      ["roost_read_soul", "roost_update_soul"],
    );
    assert.match(native.options.developerInstructions, /periodic reflection/);
    assert.equal(native.toolChecks.updated, true);
    assert.equal(native.toolChecks.foreignRejected, true);
    assert.equal(native.toolChecks.staleRejected, true);
    assert.ok(
      (await run(readTimeline(a.id))).some((m) => m.noticeKind === "soul"),
    );
    assert.ok(
      !(await run(readTimeline(a.id))).some(
        (m) => m.role === "user" && m.text === "soul",
      ),
    );
    const quiet = await run(runReflectionNow(a.id, randomUUID()));
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET prompt='quiet' WHERE id=?").run(quiet.id),
      ),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === quiet.id)?.status ===
        "completed",
    );
    assert.ok(
      !(await run(readTimeline(a.id))).some(
        (m) => m.text === "ROOST_NO_UPDATE",
      ),
    );
  } finally {
    await stop?.();
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
