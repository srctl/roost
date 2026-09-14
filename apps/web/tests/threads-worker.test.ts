import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  getAgentConversation,
  saveAgent,
  withAgentStore,
} from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { sendConversation } from "../src/server/codex/conversation.server";
import { enqueueChat, listRuns } from "../src/server/runs/store.server";
import { openReplyThread } from "../src/server/runs/threads.server";
import { readTimeline } from "../src/server/runs/timeline.server";
import { ensureTimeline, startWorker } from "../src/server/runs/worker.server";

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Fixture worker timed out");
}

test("worker resume and native-session rollover preserve imported assistant/activity IDs; delayed handoffs stay in child", async () => {
  const root = mkdtempSync(join(tmpdir(), "roost-thread-worker-"));
  const previous = {
    dir: process.env.ROOST_DATA_DIR,
    home: process.env.CODEX_HOME,
    binary: process.env.ROOST_CODEX_BINARY,
  };
  process.env.ROOST_DATA_DIR = root;
  process.env.CODEX_HOME = root;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  writeFileSync(
    join(root, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  let stop: (() => Promise<void>) | undefined;
  try {
    const run = Effect.runPromise;
    const a = await run(
      saveAgent({
        id: randomUUID(),
        name: "Moss",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const b = await run(
      saveAgent({
        id: randomUUID(),
        name: "Wisp",
        instructions: "Help",
        character: "wisp",
        model: "fake",
      }),
    );
    const initialId = randomUUID();
    await run(
      sendConversation(
        { agentId: a.id, messageId: initialId, text: "activity" },
        () => {},
      ),
    );
    await run(ensureTimeline(a.id));
    const imported = await run(readTimeline(a.id));
    assert.ok(imported.some((m) => m.id === "cmd"));
    stop = startWorker();
    const next = randomUUID();
    await run(
      enqueueChat({ agentId: a.id, messageId: next, text: "Continue" }),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === next)?.status ===
        "completed",
    );
    let timeline = await run(readTimeline(a.id));
    for (const message of imported)
      assert.equal(timeline.filter((m) => m.id === message.id).length, 1);
    assert.equal(timeline.filter((m) => m.role === "assistant").length, 2);
    assert.equal(timeline.filter((m) => m.role === "activity").length, 1);
    const session = await run(getAgentConversation(a.id));
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE agent_tool_versions SET version=13 WHERE threadId=?")
          .run(session.threadId!),
      ),
    );
    const rollover = randomUUID();
    await run(
      enqueueChat({
        agentId: a.id,
        messageId: rollover,
        text: "After tool update",
      }),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === rollover)?.status ===
        "completed",
    );
    timeline = await run(readTimeline(a.id));
    assert.equal(timeline.filter((m) => m.role === "assistant").length, 3);
    assert.equal(timeline.filter((m) => m.role === "activity").length, 1);
    for (const message of imported)
      assert.equal(timeline.filter((m) => m.id === message.id).length, 1);
    const child = await run(openReplyThread(a.id, initialId));
    const reply = randomUUID();
    await run(
      enqueueChat({
        agentId: a.id,
        conversationId: child.id,
        messageId: reply,
        text: "Initial child",
      }),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === reply)?.status ===
        "completed",
    );
    const { putMessage } = await import("../src/server/runs/timeline.server");
    const sibling = await run(openReplyThread(a.id, next));
    await run(
      withAgentStore((db) => {
        putMessage(db, a.id, {
          id: "new-decision",
          role: "user",
          text: "New main decision: Friday launch",
        });
        putMessage(
          db,
          a.id,
          {
            id: "sibling-decision",
            role: "assistant",
            text: "Sibling decision: keyboard checks passed",
          },
          sibling.id,
        );
      }),
    );
    const retrieval = randomUUID();
    await run(
      enqueueChat({
        agentId: a.id,
        conversationId: child.id,
        messageId: retrieval,
        text: "shared-context",
      }),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === retrieval)?.status ===
        "completed",
    );
    const retrieved = (await run(readTimeline(a.id, child.id))).find((m) =>
      m.text.startsWith("Retrieved shared"),
    );
    assert.match(retrieved!.text, /Friday launch/);
    assert.match(retrieved!.text, /keyboard checks passed/);
    assert.match(retrieved!.text, /Quoted conversation context/);
    const { uploadAttachment } = await import(
      "../src/server/files/store.server"
    );
    const file = await run(
      uploadAttachment({
        agentId: a.id,
        name: "thread.txt",
        mimeType: "text/plain",
        bytes: new TextEncoder().encode("Scoped attachment"),
      }),
    );
    const attached = randomUUID();
    await run(
      enqueueChat({
        agentId: a.id,
        conversationId: child.id,
        messageId: attached,
        text: "Attached",
        attachmentIds: [file.id],
      }),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === attached)?.status ===
        "completed",
    );
    assert.equal(
      (await run(readTimeline(a.id, child.id))).find((m) => m.id === attached)
        ?.files?.[0]?.id,
      file.id,
    );
    assert.ok(
      !(await run(readTimeline(a.id))).some((m) =>
        m.files?.some((f) => f.id === file.id),
      ),
    );
    const { readApprovals, answerApproval } = await import(
      "../src/server/approvals/store.server"
    );
    const approvalRun = randomUUID();
    await run(
      enqueueChat({
        agentId: a.id,
        conversationId: child.id,
        messageId: approvalRun,
        text: "approval:question",
      }),
    );
    await until(async () => (await run(readApprovals(a.id))).length > 0);
    const approval = (await run(readApprovals(a.id)))[0]!;
    assert.equal(approval.runId, approvalRun);
    assert.ok(
      (await run(readTimeline(a.id, child.id))).some(
        (m) => m.referenceId === approval.id,
      ),
    );
    assert.ok(
      !(await run(readTimeline(a.id))).some(
        (m) => m.referenceId === approval.id,
      ),
    );
    await run(
      answerApproval(a.id, approval.id, {
        decision: "answer",
        answers: { choice: "Decline" },
      }),
    );
    await until(
      async () =>
        (await run(listRuns(a.id))).find((r) => r.id === approvalRun)
          ?.status === "completed",
    );
    const delegated = randomUUID();
    await run(
      enqueueChat({
        agentId: a.id,
        conversationId: child.id,
        messageId: delegated,
        text: `delegate:${b.id}`,
      }),
    );
    await until(async () =>
      (await run(listRuns(a.id))).some(
        (r) => r.kind === "handoff" && r.status === "completed",
      ),
    );
    const handoff = (await run(listRuns(a.id))).find(
      (r) => r.kind === "handoff",
    )!;
    assert.equal(handoff.conversationId, child.id);
    assert.ok(
      (await run(readTimeline(a.id, child.id))).some((m) =>
        m.title?.includes("reported back"),
      ),
    );
    assert.ok(
      !(await run(readTimeline(a.id))).some((m) =>
        m.title?.includes("reported back"),
      ),
    );
  } finally {
    await stop?.();
    await closeAgentRuntimes();
    for (const [key, value] of [
      ["ROOST_DATA_DIR", previous.dir],
      ["CODEX_HOME", previous.home],
      ["ROOST_CODEX_BINARY", previous.binary],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
