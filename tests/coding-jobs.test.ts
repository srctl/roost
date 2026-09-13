import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  changeCodingJob,
  completeCodingJob,
  continueCodingJob,
  requireCodingRun,
  startCodingJob,
  stopCodingJob,
} from "../src/server/coding/jobs.server";
import {
  getCodingJob,
  getCodingSettings,
  saveCodingSettings,
  saveExecutionProfile,
  updateCodingJob,
} from "../src/server/coding/store.server";
import {
  claimRun,
  claimSteeringRun,
  enqueueChat,
  finishRun,
  type Run,
} from "../src/server/runs/store.server";
import { writeTransaction } from "../src/server/transaction.server";

const run = Effect.runPromise;
async function fixture(
  task: (agentId: string, runId: string) => Promise<void>,
) {
  const directory = mkdtempSync("/tmp/roost-coding-jobs-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Project",
        kind: "coding",
        instructions: "Develop this project",
        character: "moss",
        model: "test",
      }),
    );
    const runId = randomUUID();
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES (?,?,'chat','Develop the assigned task','running',?)",
          )
          .run(runId, agent.id, Date.now()),
      ),
    );
    await task(agent.id, runId);
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
}
const startInput = () => ({
  requestId: randomUUID(),
  title: "Implement settings",
  brief: "Implement settings and run tests.",
  cwd: "/tmp/project-worktree",
  workerKind: "codex",
  profileId: null,
});

test("coding assignments snapshot instructions and retry by durable request ID", async () =>
  fixture(async (agentId, runId) => {
    const settings = await run(
      saveCodingSettings({
        ...(await run(getCodingSettings(agentId))),
        repository: "/tmp/project",
        projectInstructions: "Use pnpm and run tests.",
      }),
    );
    const input = startInput();
    const job = await run(startCodingJob(agentId, runId, input));
    assert.equal(job.sourceUrl, "");
    assert.equal(job.sourceRunId, runId);
    assert.match(job.brief, /Use pnpm and run tests/);
    assert.match(job.sessionName, /^roost-/);
    assert.match(job.workerName, /^roost-/);
    await run(
      saveCodingSettings({ ...settings, projectInstructions: "Changed setup" }),
    );
    assert.deepEqual(await run(startCodingJob(agentId, runId, input)), job);
    await assert.rejects(
      run(
        startCodingJob(agentId, runId, { ...input, brief: "Different task" }),
      ),
      /already used/,
    );
    await assert.rejects(
      run(
        startCodingJob(agentId, runId, { ...startInput(), cwd: "../project" }),
      ),
      /absolute/,
    );
  }));

test("remote instructions require a provisioned destination and preserve explicit ticket provenance", async () =>
  fixture(async (agentId, runId) => {
    const profile = await run(
      saveExecutionProfile({
        id: randomUUID(),
        name: "New remote machine",
        kind: "ssh",
        target: "",
        instructions: "Provision a new machine, then clone the repository.",
        revision: 0,
      }),
    );
    const input = {
      ...startInput(),
      profileId: profile.id,
      sourceUrl: "https://www.notion.so/ticket",
    };
    await assert.rejects(
      run(startCodingJob(agentId, runId, input)),
      /SSH destination|SSH.*remote|supply the SSH/,
    );
    const job = await run(
      startCodingJob(agentId, runId, { ...input, remoteTarget: "dev@machine" }),
    );
    assert.equal(job.remoteTarget, "dev@machine");
    assert.equal(job.sourceUrl, input.sourceUrl);
    assert.equal(job.profileInstructions, profile.instructions);
    await assert.rejects(
      run(
        startCodingJob(agentId, runId, {
          ...input,
          remoteTarget: "dev@other-machine",
        }),
      ),
      /already used/,
    );
  }));

test("reflection cannot configure or run jobs and coding updates can act only on their reporting job", async () =>
  fixture(async (agentId, runId) => {
    const job = await run(startCodingJob(agentId, runId, startInput()));
    const other = await run(startCodingJob(agentId, runId, startInput()));
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET kind='reflection' WHERE id=?").run(runId),
      ),
    );
    for (const mode of ["read", "configure", "start", "continue"] as const)
      await assert.rejects(
        run(
          withAgentStore((db) =>
            requireCodingRun(db, agentId, runId, mode, job.id),
          ),
        ),
        /reflection/,
      );
    await run(
      withAgentStore((db) =>
        writeTransaction(db, () => {
          db.prepare("UPDATE runs SET kind='coding' WHERE id=?").run(runId);
          db.prepare(
            "INSERT INTO coding_job_updates(runId,agentId,jobId) VALUES(?,?,?)",
          ).run(runId, agentId, job.id);
        }),
      ),
    );
    await run(
      withAgentStore((db) =>
        requireCodingRun(db, agentId, runId, "continue", job.id),
      ),
    );
    await assert.rejects(
      run(
        withAgentStore((db) =>
          requireCodingRun(db, agentId, runId, "continue", other.id),
        ),
      ),
      /only on the job/,
    );
    await assert.rejects(
      run(
        withAgentStore((db) =>
          requireCodingRun(db, agentId, runId, "configure"),
        ),
      ),
      /user conversation/,
    );
    await assert.rejects(
      run(startCodingJob(agentId, runId, startInput())),
      /cannot start/,
    );
  }));

test("follow-ups have durable IDs and completion requires the current reviewed job revision", async () =>
  fixture(async (agentId, runId) => {
    const job = await run(startCodingJob(agentId, runId, startInput()));
    await assert.rejects(
      run(
        completeCodingJob(agentId, runId, {
          id: job.id,
          revision: job.revision,
          summary: "Done",
        }),
      ),
      /Review the worker output/,
    );
    const reviewed = await run(
      updateCodingJob(agentId, job.id, {
        status: "review",
        output: "Tests passed",
        observedWorking: true,
      }),
    );
    await assert.rejects(
      run(
        completeCodingJob(agentId, runId, {
          id: job.id,
          revision: job.revision,
          summary: "Done",
        }),
      ),
      /changed/,
    );
    const followup = {
      id: job.id,
      requestId: randomUUID(),
      prompt: "Also cover the empty case.",
    };
    const queued = await run(continueCodingJob(agentId, runId, followup));
    assert.deepEqual(
      await run(continueCodingJob(agentId, runId, followup)),
      queued,
    );
    await assert.rejects(
      run(
        continueCodingJob(agentId, runId, {
          ...followup,
          prompt: "Different instruction",
        }),
      ),
      /already used/,
    );
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).observedWorking,
      false,
    );
    const result = await run(
      updateCodingJob(agentId, job.id, {
        status: "review",
        observedWorking: true,
      }),
    );
    const done = await run(
      completeCodingJob(agentId, runId, {
        id: result.id,
        revision: result.revision,
        summary: "Implemented settings; all tests passed.",
      }),
    );
    assert.equal(done.status, "completed");
    assert.ok(done.revision > reviewed.revision);
  }));

test("job state and a single reporting turn commit together; queued cancellation never starts a worker", async () =>
  fixture(async (agentId, runId) => {
    const job = await run(startCodingJob(agentId, runId, startInput()));
    await run(
      withAgentStore((db) =>
        writeTransaction(db, () =>
          changeCodingJob(db, job, {
            status: "review",
            output: "Checks passed",
          }),
        ),
      ),
    );
    const updated = await run(getCodingJob(agentId, job.id));
    await run(
      withAgentStore((db) =>
        writeTransaction(db, () =>
          changeCodingJob(db, updated, { output: "Checks still passed" }),
        ),
      ),
    );
    assert.equal(
      await run(
        withAgentStore((db) =>
          Number(
            db
              .prepare(
                "SELECT COUNT(*) AS n FROM coding_job_updates WHERE jobId=?",
              )
              .get(job.id)?.n,
          ),
        ),
      ),
      1,
    );
    const queued = await run(startCodingJob(agentId, runId, startInput()));
    await assert.rejects(
      run(stopCodingJob(randomUUID(), queued.id)),
      /not found/,
    );
    const cancelled = await run(stopCodingJob(agentId, queued.id));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.dispatchedAt, null);
    assert.deepEqual(await run(stopCodingJob(agentId, queued.id)), cancelled);
  }));

test("only an explicit conversation can accept an inspected uncertain submission after it settled", async () =>
  fixture(async (agentId, runId) => {
    const job = await run(startCodingJob(agentId, runId, startInput()));
    const settled = await run(
      updateCodingJob(agentId, job.id, {
        status: "blocked",
        lastWorkerState: "idle",
        output: "The changes are present; all tests passed.",
      }),
    );
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runs SET kind='coding' WHERE id=?").run(runId);
        db.prepare(
          "INSERT INTO coding_job_updates(runId,agentId,jobId) VALUES(?,?,?)",
        ).run(runId, agentId, job.id);
      }),
    );
    const completion = {
      id: job.id,
      revision: settled.revision,
      summary: "Inspected the changes and test output.",
    };
    await assert.rejects(
      run(completeCodingJob(agentId, runId, completion)),
      /user conversation/,
    );
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET kind='chat' WHERE id=?").run(runId),
      ),
    );
    assert.equal(
      (await run(completeCodingJob(agentId, runId, completion))).status,
      "completed",
    );
  }));

test("new user requests during coding updates keep their own conversation permissions", async () =>
  fixture(async (agentId, runId) => {
    const active = await run(
      withAgentStore((db) => {
        db.prepare(
          "INSERT INTO worker_lease (id,owner,heartbeat) VALUES (1,'test-worker',?)",
        ).run(Date.now());
        return db
          .prepare(
            "UPDATE runs SET kind='coding',owner='test-worker' WHERE id=? RETURNING *",
          )
          .get(runId) as Run;
      }),
    );
    const messageId = randomUUID();
    const receipt = await run(
      enqueueChat({
        agentId,
        messageId,
        text: "Start another assignment and update my project instructions.",
      }),
    );
    assert.equal(receipt.id, messageId);
    assert.equal(await run(claimSteeringRun(active)), undefined);
    await run(
      finishRun(active, "completed", [
        {
          id: "result",
          role: "assistant",
          text: "The previous assignment is ready.",
        },
      ]),
    );
    const next = await run(claimRun("test-worker"));
    assert.equal(next?.id, messageId);
    assert.equal(next?.kind, "chat");
    await run(
      withAgentStore((db) =>
        requireCodingRun(db, agentId, next!.id, "configure"),
      ),
    );
  }));

test("delayed coding outcomes stay in the dedicated job discussion and preserve originating child provenance", async () =>
  fixture(async (agentId, runId) => {
    const { putMessage, readTimeline } = await import(
      "../src/server/runs/timeline.server"
    );
    const { openReplyThread } = await import(
      "../src/server/runs/threads.server"
    );
    await run(
      withAgentStore((db) =>
        putMessage(db, agentId, {
          id: "coding-parent",
          role: "user",
          text: "Review this work",
        }),
      ),
    );
    const child = await run(openReplyThread(agentId, "coding-parent"));
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE runs SET conversationId=? WHERE id=?")
          .run(child.id, runId),
      ),
    );
    const job = await run(startCodingJob(agentId, runId, startInput()));
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(runId);
        db.prepare(
          "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES (?,?,'chat','New main work','running',?)",
        ).run(randomUUID(), agentId, Date.now());
        changeCodingJob(db, job, {
          status: "review",
          output: "Delayed verified result",
        });
      }),
    );
    await run(
      withAgentStore((db) =>
        assert.equal(
          db
            .prepare("SELECT conversationId FROM runs WHERE kind='coding'")
            .get()!.conversationId,
          job.id,
        ),
      ),
    );
    assert.ok(
      (await run(readTimeline(agentId, job.id))).some((m) =>
        m.title?.includes("ready to review"),
      ),
    );
    assert.equal((await run(getCodingJob(agentId, job.id))).sourceRunId, runId);
    assert.equal((await run(readTimeline(agentId, child.id))).length, 0);
    assert.ok(
      !(await run(readTimeline(agentId))).some((m) =>
        m.title?.includes("ready to review"),
      ),
    );
  }));
