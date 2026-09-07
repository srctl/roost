import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { readAgentActivity } from "../src/server/agents/activity.server";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  delegateTask,
  listDelegations,
} from "../src/server/delegations/store.server";
import {
  cancelRun,
  claimRun,
  enqueueChat,
  finishRun,
  listRuns,
  schedulerTick,
} from "../src/server/runs/store.server";
import { readTimeline } from "../src/server/runs/timeline.server";

const run = Effect.runPromise;

test("delegation frees the parent, isolates work, and delivers terminal outcomes once behind active user work", async () => {
  const directory = mkdtempSync("/tmp/roost-delegation-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
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

    const guy = await create("Guy"),
      shopping = await create("Shopping");
    await run(
      enqueueChat({
        agentId: guy.id,
        messageId: randomUUID(),
        text: "Find a shelf",
      }),
    );
    await run(schedulerTick("worker"));
    const parent = (await run(claimRun("worker")))!;
    const task = {
      requestId: randomUUID(),
      agentId: shopping.id,
      task: "Find a shelf; do not purchase.",
    };
    await run(delegateTask(guy.id, parent.id, task));
    await run(delegateTask(guy.id, parent.id, task));
    await assert.rejects(
      run(delegateTask(guy.id, parent.id, { ...task, task: "Different" })),
      /already been used/,
    );
    await assert.rejects(
      run(
        delegateTask(guy.id, parent.id, {
          ...task,
          requestId: randomUUID(),
          agentId: guy.id,
        }),
      ),
      /yourself/,
    );
    assert.equal((await run(listRuns(shopping.id))).length, 1);
    const child = (await run(claimRun("worker")))!;
    assert.equal(child.kind, "delegation");
    assert.equal(child.agentId, shopping.id);
    await assert.rejects(
      run(
        delegateTask(shopping.id, child.id, {
          ...task,
          requestId: randomUUID(),
          agentId: guy.id,
        }),
      ),
      /Only an active user conversation/,
    );
    await run(
      finishRun(parent, "completed", [
        { id: "handoff", role: "assistant", text: "Shopping is looking." },
      ]),
    );
    assert.equal((await run(readAgentActivity()))[guy.id], "delegating");
    assert.equal((await run(readAgentActivity()))[shopping.id], "working");
    await run(
      enqueueChat({
        agentId: guy.id,
        messageId: randomUUID(),
        text: "Another question",
      }),
    );
    const other = (await run(claimRun("worker")))!;
    assert.equal(other.agentId, guy.id);
    await run(
      finishRun(child, "completed", [
        {
          id: "answer",
          role: "assistant",
          text: "Found a shelf. No purchase.",
        },
      ]),
    );
    await run(schedulerTick("worker"));
    await run(schedulerTick("worker"));
    assert.equal(await run(claimRun("worker")), undefined);
    const returns = (await run(listRuns(guy.id))).filter(
      (r) => r.kind === "handoff",
    );
    assert.equal(returns.length, 1);
    assert.match(returns[0]!.prompt, /Found a shelf/);
    assert.equal((await run(readAgentActivity()))[guy.id], "working");
    await run(finishRun(other, "completed", []));
    const result = (await run(claimRun("worker")))!;
    assert.equal(result.id, returns[0]!.id);
    await assert.rejects(
      run(
        delegateTask(guy.id, result.id, { ...task, requestId: randomUUID() }),
      ),
      /Only an active user conversation/,
    );
    await run(
      finishRun(result, "completed", [
        { id: "update", role: "assistant", text: "Here's the shelf." },
      ]),
    );
    assert.deepEqual(await run(readAgentActivity()), {});
    assert.equal(
      (await run(listDelegations(guy.id)))[0]!.resultRunId,
      result.id,
    );
    assert.ok(
      (await run(readTimeline(guy.id))).some(
        (m) => m.noticeKind === "delegation" && m.referenceId === shopping.id,
      ),
    );

    // Cancellation and worker loss must both produce a report, without replaying work.
    await run(
      enqueueChat({
        agentId: guy.id,
        messageId: randomUUID(),
        text: "Two checks",
      }),
    );
    const root = (await run(claimRun("worker")))!;
    const stopped = { ...task, requestId: randomUUID() };
    const interrupted = { ...task, requestId: randomUUID() };
    await run(delegateTask(guy.id, root.id, stopped));
    await run(delegateTask(guy.id, root.id, interrupted));
    await run(cancelRun(shopping.id, stopped.requestId));
    await run(claimRun("worker"));
    await run(finishRun(root, "completed", []));
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE worker_lease SET heartbeat=0").run(),
      ),
    );
    await run(schedulerTick("replacement"));
    await run(schedulerTick("replacement"));
    const tasks = await run(listDelegations(guy.id));
    assert.equal(
      tasks.find((t) => t.id === stopped.requestId)!.status,
      "cancelled",
    );
    assert.equal(
      tasks.find((t) => t.id === interrupted.requestId)!.status,
      "interrupted",
    );
    assert.equal(
      (await run(listRuns(guy.id))).filter((r) => r.kind === "handoff").length,
      3,
    );
    assert.ok(tasks.every((t) => t.resultRunId));
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
});
