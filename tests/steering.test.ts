import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { uploadAttachment } from "../src/server/files/store.server";
import { readConversationSnapshot } from "../src/server/runs/conversation-snapshot.server";
import {
  cancelRun,
  claimRun,
  claimSteeringRun,
  enqueueChat,
  finishRun,
  listRuns,
  schedulerTick,
} from "../src/server/runs/store.server";
import { readTimeline } from "../src/server/runs/timeline.server";
import { startWorker } from "../src/server/runs/worker.server";

const run = Effect.runPromise;

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for steering");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function fixture(
  task: (directory: string, agentId: string) => Promise<void>,
) {
  const directory = mkdtempSync("/tmp/roost-steering-");
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
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Steering",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    await task(directory, agent.id);
  } finally {
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test("follow-ups and attachments steer one live turn, deduplicate retries, and preserve Stop", () =>
  fixture(async (directory, agentId) => {
    const first = randomUUID();
    await run(enqueueChat({ agentId, messageId: first, text: "steer-wait" }));
    const stop = startWorker();
    try {
      await until(
        async () =>
          !!(await run(listRuns(agentId))).find((r) => r.id === first)
            ?.threadId,
      );
      const file = await run(
        uploadAttachment({
          agentId,
          name: "notes.txt",
          mimeType: "text/plain",
          bytes: Buffer.from("Focus on the new requirement."),
        }),
      );
      const followUp = {
        agentId,
        messageId: randomUUID(),
        text: "Use these notes",
        attachmentIds: [file.id],
      };
      assert.equal((await run(enqueueChat(followUp))).id, first);
      await run(enqueueChat(followUp));
      await until(
        async () =>
          (await run(listRuns(agentId))).find(
            (r) => r.id === followUp.messageId,
          )?.status === "steering",
      );
      const snapshot = await run(readConversationSnapshot(agentId));
      assert.equal(snapshot.busy, true);
      assert.equal(snapshot.runId, first);
      const last = randomUUID();
      await run(
        enqueueChat({ agentId, messageId: last, text: "finish steering" }),
      );
      await until(async () =>
        (await run(listRuns(agentId))).every((r) => r.status === "completed"),
      );
      const runs = await run(listRuns(agentId));
      assert.equal(runs.length, 3);
      assert.equal(new Set(runs.map((r) => r.threadId)).size, 1);
      const native = JSON.parse(
        readFileSync(
          join(
            directory,
            "agents",
            agentId,
            "codex",
            `fake-${runs[0]!.threadId}.json`,
          ),
          "utf8",
        ),
      );
      assert.equal(native.turns.length, 1);
      const users = native.turns[0].items.filter(
        (item: { type: string }) => item.type === "userMessage",
      );
      assert.deepEqual(
        users.map((item: { clientId: string }) => item.clientId),
        [first, followUp.messageId, last],
      );
      assert.match(users[1].content[1].text, /notes.txt/);
      const timeline = await run(readTimeline(agentId));
      assert.equal(
        timeline.filter((m) => m.id === followUp.messageId).length,
        1,
      );
      assert.equal(
        timeline.find((m) => m.id === followUp.messageId)?.files?.[0]?.id,
        file.id,
      );
      assert.equal(
        timeline.at(-1)?.text,
        "steer-wait | Use these notes | finish steering",
      );
      assert.equal((await run(readConversationSnapshot(agentId))).busy, false);
      await run(enqueueChat(followUp));
      assert.equal((await run(listRuns(agentId))).length, 3);
    } finally {
      await stop();
    }
  }));

test("stopping a steered message cancels its parent and prevents replay", () =>
  fixture(async (_directory, agentId) => {
    const first = randomUUID();
    await run(enqueueChat({ agentId, messageId: first, text: "steer-wait" }));
    const stop = startWorker();
    try {
      await until(
        async () =>
          !!(await run(listRuns(agentId))).find((r) => r.id === first)
            ?.threadId,
      );
      const followUp = randomUUID();
      await run(
        enqueueChat({ agentId, messageId: followUp, text: "Keep working" }),
      );
      await until(
        async () =>
          (await run(listRuns(agentId))).find((r) => r.id === followUp)
            ?.status === "steering",
      );
      await run(cancelRun(agentId, followUp));
      await until(async () =>
        (await run(listRuns(agentId))).every((r) => r.status === "cancelled"),
      );
      assert.equal((await run(readConversationSnapshot(agentId))).busy, false);
    } finally {
      await stop();
    }
  }));

test("finished turns leave pending messages queued; ownership and restart recovery fence steering", () =>
  fixture(async (_directory, agentId) => {
    await run(enqueueChat({ agentId, messageId: randomUUID(), text: "First" }));
    await run(schedulerTick("owner"));
    const first = (await run(claimRun("owner")))!;
    const second = { agentId, messageId: randomUUID(), text: "Second" };
    await run(enqueueChat(second));
    assert.equal(
      await run(claimSteeringRun({ ...first, owner: "foreign" })),
      undefined,
    );
    await run(finishRun(first, "completed", []));
    assert.equal(await run(claimSteeringRun(first)), undefined);
    const next = (await run(claimRun("owner")))!;
    assert.equal(next.id, second.messageId);
    await run(enqueueChat({ agentId, messageId: randomUUID(), text: "Third" }));
    assert.ok(await run(claimSteeringRun(next)));
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE worker_lease SET heartbeat=0").run(),
      ),
    );
    await run(schedulerTick("new-owner"));
    assert.equal(
      (await run(listRuns(agentId))).filter((r) => r.status === "interrupted")
        .length,
      2,
    );
    assert.equal(await run(claimRun("new-owner")), undefined);
  }));
