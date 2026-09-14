import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  answerApproval,
  createApproval,
  readApprovals,
  waitForApproval,
} from "../src/server/approvals/store.server";
import { handleNativeApproval } from "../src/server/approvals/tools.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import {
  cancelRun,
  enqueueChat,
  listRuns,
  schedulerTick,
} from "../src/server/runs/store.server";
import { readTimeline } from "../src/server/runs/timeline.server";
import { startWorker } from "../src/server/runs/worker.server";

const run = Effect.runPromise;
test("native approvals reject another turn and decline commands without a reviewable action", async () => {
  const context = {
    agentId: randomUUID(),
    runId: randomUUID(),
    threadId: "thread",
    requestKey: "request",
  };
  const request = {
    threadId: "thread",
    turnId: "turn",
    itemId: "item",
    command: "echo ok",
  };
  await assert.rejects(
    handleNativeApproval(
      context,
      "item/commandExecution/requestApproval",
      request,
      "different-turn",
      undefined,
    ),
    /active turn/,
  );
  assert.deepEqual(
    await handleNativeApproval(
      context,
      "item/commandExecution/requestApproval",
      { ...request, command: null },
      "turn",
      undefined,
    ),
    { decision: "decline" },
  );
  assert.deepEqual(
    await handleNativeApproval(
      context,
      "item/fileChange/requestApproval",
      request,
      "turn",
      undefined,
    ),
    { decision: "decline" },
  );
  assert.deepEqual(
    await handleNativeApproval(
      context,
      "item/commandExecution/requestApproval",
      { ...request, availableDecisions: ["acceptForSession", "decline"] },
      "turn",
      undefined,
    ),
    { decision: "decline" },
  );
});
async function until<A>(read: () => Promise<A>, done: (value: A) => boolean) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for approval state.");
}

test("approvals pause and drain existing runs during maintenance while new work stays blocked", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-approvals-"));
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    ROOST_CODEX_BINARY: process.env.ROOST_CODEX_BINARY,
  };
  Object.assign(process.env, {
    ROOST_DATA_DIR: directory,
    CODEX_HOME: directory,
    ROOST_CODEX_BINARY: fileURLToPath(
      new URL("./fixtures/chat-server.mjs", import.meta.url),
    ),
  });
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  let stop: (() => Promise<void>) | undefined;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    stop = startWorker();
    async function begin(text: string) {
      const id = randomUUID();
      await run(enqueueChat({ agentId: agent.id, messageId: id, text }));
      startWorker();
      const requests = await until(
        () => run(readApprovals(agent.id)),
        (rows) => rows.length === 1,
      );
      return { id, request: requests[0]! };
    }
    const action = await begin("approval:action");
    assert.match(action.request.details, /recipient@example.com/);
    assert.equal(
      (await run(listRuns(agent.id))).find((r) => r.id === action.id)?.status,
      "running",
    );
    await assert.rejects(
      run(
        answerApproval(randomUUID(), action.request.id, {
          decision: "approve",
        }),
      ),
      /not found/,
    );
    await run(
      answerApproval(agent.id, action.request.id, { decision: "approve" }),
    );
    await run(
      answerApproval(agent.id, action.request.id, { decision: "approve" }),
    );
    await assert.rejects(
      run(answerApproval(agent.id, action.request.id, { decision: "decline" })),
      /already resolved/,
    );
    await until(
      () => run(listRuns(agent.id)),
      (rows) => rows.find((r) => r.id === action.id)?.status === "completed",
    );
    assert.ok(
      (await run(readTimeline(agent.id))).some(
        (m) =>
          m.id === `approval:${action.request.id}` &&
          m.text === "Approved once",
      ),
    );

    const command = await begin("approval:command");
    assert.match(command.request.details, /printf approved/);
    await run(
      withAgentStore((db) =>
        db.exec("UPDATE runtime_control SET maintenance=1 WHERE id=1"),
      ),
    );
    assert.equal(
      (await run(readApprovals(agent.id)))[0]?.id,
      command.request.id,
    );
    await assert.rejects(
      run(
        enqueueChat({
          agentId: agent.id,
          messageId: randomUUID(),
          text: "New work",
        }),
      ),
      /updating/,
    );
    await assert.rejects(
      run(
        answerApproval(randomUUID(), command.request.id, {
          decision: "approve",
        }),
      ),
      /not found/,
    );
    await run(
      answerApproval(agent.id, command.request.id, { decision: "decline" }),
    );
    const commandRuns = await until(
      () => run(listRuns(agent.id)),
      (rows) => rows.find((r) => r.id === command.id)?.status === "completed",
    );
    assert.match(
      commandRuns.find((r) => r.id === command.id)!.messages,
      /decline/,
    );
    assert.equal((await run(readApprovals(agent.id))).length, 0);
    await run(
      withAgentStore((db) =>
        db.exec("UPDATE runtime_control SET maintenance=0 WHERE id=1"),
      ),
    );

    const question = await begin("approval:question");
    await assert.rejects(
      run(
        answerApproval(agent.id, question.request.id, {
          decision: "answer",
          answers: { choice: "invalid" },
        }),
      ),
      /every question/,
    );
    await run(
      answerApproval(agent.id, question.request.id, {
        decision: "answer",
        answers: { choice: "Accept" },
      }),
    );
    await until(
      () => run(listRuns(agent.id)),
      (rows) => rows.find((r) => r.id === question.id)?.status === "completed",
    );

    const cancelled = await begin("approval:action");
    await run(
      withAgentStore((db) =>
        db.exec("UPDATE runtime_control SET maintenance=1 WHERE id=1"),
      ),
    );
    await run(cancelRun(agent.id, cancelled.id));
    await assert.rejects(
      run(
        answerApproval(agent.id, cancelled.request.id, { decision: "approve" }),
      ),
      /no longer active/,
    );
    await until(
      () => run(listRuns(agent.id)),
      (rows) => rows.find((r) => r.id === cancelled.id)?.status === "cancelled",
    );
    assert.equal(
      (await run(readApprovals(agent.id, cancelled.request.id)))[0]?.status,
      "cancelled",
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

test("restart recovery expires old approvals and cannot reuse changed requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-approval-recovery-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const context = {
      agentId: agent.id,
      runId: randomUUID(),
      threadId: "thread",
      requestKey: "request",
    };
    await run(
      enqueueChat({
        agentId: agent.id,
        messageId: context.runId,
        text: "Prepare work",
      }),
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE runs SET status='running',threadId='thread' WHERE id=?",
          )
          .run(context.runId),
      ),
    );
    const input = {
      title: "Publish?",
      details: "Publish exactly this prepared report.",
    };
    const id = await run(createApproval(context, input));
    assert.equal(await run(createApproval(context, input)), id);
    await assert.rejects(
      run(createApproval(context, { ...input, details: "Different report" })),
      /changed/,
    );
    await run(schedulerTick("new-worker"));
    assert.equal(
      (await run(readApprovals(agent.id, id)))[0]?.status,
      "cancelled",
    );
    await assert.rejects(
      run(answerApproval(agent.id, id, { decision: "approve" })),
      /resolved/,
    );
    // A persisted Stop must win even when approval was answered just before
    // the waiting callback consumes it, ahead of the worker's abort tick.
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE runs SET status='running',cancelRequested=0 WHERE id=?",
          )
          .run(context.runId),
      ),
    );
    const raceContext = { ...context, requestKey: "approve-then-stop" };
    const raceId = await run(createApproval(raceContext, input));
    const waiting = waitForApproval(raceContext, input);
    const stopped = assert.rejects(waiting, /no longer active/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    Effect.runSync(answerApproval(agent.id, raceId, { decision: "approve" }));
    Effect.runSync(cancelRun(agent.id, context.runId));
    await stopped;
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
