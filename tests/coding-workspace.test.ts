import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import {
  jobWorkflowLabel,
  WebUrl,
} from "../src/features/coding/workspace-schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  changeCodingJob,
  completeCodingJob,
  continueCodingJob,
} from "../src/server/coding/jobs.server";
import {
  createCodingJob,
  getCodingJob,
  updateCodingJob,
} from "../src/server/coding/store.server";
import {
  type codingAdapter,
  tickCodingJobs,
} from "../src/server/coding/worker.server";
import {
  continueJobFeedback,
  reportCodingWorkspace,
} from "../src/server/coding/workspace.server";
import {
  getJobWorkspace,
  saveJobFeedback,
} from "../src/server/coding/workspace-store.server";

const run = Effect.runPromise;
async function fixture(
  task: (agentId: string, id: string, runId: string) => Promise<void>,
) {
  const directory = mkdtempSync("/tmp/roost-job-workspace-test-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Test",
        kind: "coding",
        instructions: "Original authorization",
        character: "moss",
        model: "fake",
      }),
    );
    const id = randomUUID(),
      runId = randomUUID();
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES(?,?,'chat','Authorized task','running',?)",
          )
          .run(runId, agent.id, Date.now()),
      ),
    );
    await run(
      createCodingJob({
        id,
        agentId: agent.id,
        title: "Task",
        brief: "Original task",
        cwd: "/tmp/fixture",
        sessionName: "owned",
        workerName: "worker",
        workerKind: "codex",
      }),
    );
    await run(
      updateCodingJob(agent.id, id, {
        status: "review",
        sessionIdentity: "owned-session",
        nativeSessionId: "native",
        lastWorkerState: "idle",
        observedWorking: true,
      }),
    );
    await task(agent.id, id, runId);
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
}
async function report(
  agentId: string,
  id: string,
  runId: string,
  overrides: Record<string, unknown> = {},
) {
  const { workspace } = await run(getJobWorkspace(agentId, id));
  return run(
    reportCodingWorkspace(agentId, runId, {
      ...workspace,
      id,
      workflow: "feedback",
      previewUrl: "https://roost-dev.exe.xyz:4322/",
      previewRevision: "r05",
      previewAvailability: "running",
      ...overrides,
    }),
  );
}
const feedback = (
  agentId: string,
  id: string,
  text = "Keep the compact layout",
) => ({ agentId, id, requestId: randomUUID(), text, previewRevision: "r05" });

test("preview metadata persists independently of execution and completion; rejects stale and unsafe reports", () =>
  fixture(async (agent, id, runId) => {
    const before = await run(getCodingJob(agent, id));
    const workspace = await report(agent, id, runId);
    assert.equal(jobWorkflowLabel(before, workspace), "Ready for feedback");
    await report(agent, id, runId, { previewAvailability: "unavailable" });
    assert.equal((await run(getCodingJob(agent, id))).status, "review");
    assert.equal(
      (await run(getJobWorkspace(agent, id))).workspace.previewUrl,
      workspace.previewUrl,
    );
    await assert.rejects(
      run(
        reportCodingWorkspace(agent, runId, { ...workspace, id, revision: 0 }),
      ),
      /changed/,
    );
    await assert.rejects(
      report(agent, id, runId, { previewUrl: "javascript:alert(1)" }),
    );
    await assert.rejects(
      report(agent, id, runId, {
        previewUrl: "https://user:secret@example.com",
      }),
    );
    assert.equal(
      (await run(getCodingJob(agent, id))).revision,
      before.revision,
    );
    for (const value of [
      "data:text/html,x",
      "file:///tmp/x",
      "//example.com",
      "https://a:b@host/",
    ])
      assert.equal(Schema.is(WebUrl)(value), false);
  }));

test("feedback is a durable linked timeline notice with idempotency, no run or worker input", () =>
  fixture(async (agent, id, runId) => {
    await report(agent, id, runId);
    const input = feedback(agent, id);
    await run(saveJobFeedback(input));
    await run(saveJobFeedback(input));
    const saved = await run(getJobWorkspace(agent, id));
    assert.equal(saved.feedback.length, 1);
    assert.equal(saved.feedback[0]!.text, input.text);
    await assert.rejects(
      run(saveJobFeedback({ ...input, text: "different" })),
      /already used/,
    );
    await assert.rejects(
      run(saveJobFeedback({ ...input, agentId: randomUUID() })),
      /not found/,
    );
    await run(
      withAgentStore((db) => {
        assert.equal(db.prepare("SELECT count(*) n FROM runs").get()!.n, 1);
        assert.equal(
          db.prepare("SELECT count(*) n FROM coding_job_inputs").get()!.n,
          0,
        );
        assert.equal(
          JSON.parse(
            String(
              db
                .prepare("SELECT message FROM timeline WHERE id=?")
                .get(input.requestId)!.message,
            ),
          ).role,
          "notice",
        );
      }),
    );
  }));

test("explicit feedback queues exactly once on same owned worker, not a new assignment", () =>
  fixture(async (agent, id, runId) => {
    await report(agent, id, runId);
    const input = feedback(agent, id);
    await run(saveJobFeedback(input));
    const job = await run(getCodingJob(agent, id));
    const submit = {
      agentId: agent,
      id,
      requestId: randomUUID(),
      messageIds: [input.requestId],
      revision: job.revision,
    };
    await run(continueJobFeedback(submit));
    await run(continueJobFeedback(submit));
    const next = await run(getCodingJob(agent, id));
    assert.equal(next.status, "running");
    assert.equal(next.brief, job.brief);
    assert.equal(next.assignment, job.assignment);
    assert.equal(next.sessionIdentity, job.sessionIdentity);
    assert.equal(next.nativeSessionId, job.nativeSessionId);
    await assert.rejects(
      run(
        continueJobFeedback({
          ...submit,
          requestId: randomUUID(),
          revision: next.revision,
        }),
      ),
      /already submitted/,
    );
    const saved = await run(getJobWorkspace(agent, id));
    assert.equal(saved.workspace.workflow, "working");
    assert.equal(saved.feedback[0]!.delivery, "queued");
    await run(
      withAgentStore((db) => {
        assert.equal(
          db.prepare("SELECT count(*) n FROM coding_jobs").get()!.n,
          1,
        );
        assert.equal(
          db.prepare("SELECT count(*) n FROM coding_job_inputs").get()!.n,
          1,
        );
      }),
    );
    let prompts = 0,
      starts = 0;
    const worker = {
      state: "idle" as const,
      output: "Test",
      sessionIdentity: "owned-session",
      nativeSessionId: "native",
    };
    const adapter: typeof codingAdapter = {
      startCodingWorker: async () => {
        starts++;
        return worker;
      },
      readCodingWorker: async () => worker,
      promptCodingWorker: async () => {
        prompts++;
        return { ...worker, state: "working" };
      },
      stopCodingWorker: async () => {},
    };
    await run(
      withAgentStore((db) =>
        db
          .prepare("INSERT INTO worker_lease VALUES(1,'test',?)")
          .run(Date.now()),
      ),
    );
    await tickCodingJobs("test", new AbortController().signal, adapter);
    await run(
      withAgentStore((db) => db.exec("UPDATE coding_jobs SET lastCheckedAt=0")),
    );
    await tickCodingJobs("test", new AbortController().signal, adapter);
    assert.equal(starts, 0);
    assert.equal(prompts, 1);
  }));

test("paused feedback blocks autonomous continuation/completion and duplicate wakeups", () =>
  fixture(async (agent, id, runId) => {
    await report(agent, id, runId);
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runs SET kind='coding' WHERE id=?").run(runId);
        db.prepare("INSERT INTO coding_job_updates VALUES(?,?,?)").run(
          runId,
          id,
          agent,
        );
      }),
    );
    await assert.rejects(
      run(
        continueCodingJob(agent, runId, {
          id,
          requestId: randomUUID(),
          prompt: "Auto finalize",
        }),
      ),
      /waiting for user feedback/,
    );
    const job = await run(getCodingJob(agent, id));
    await assert.rejects(
      run(
        completeCodingJob(agent, runId, {
          id,
          revision: job.revision,
          summary: "Complete",
        }),
      ),
      /waiting for user feedback/,
    );
    await assert.rejects(
      report(agent, id, runId, { workflow: "working" }),
      /waiting for user feedback/,
    );
    await run(
      withAgentStore((db) => {
        changeCodingJob(db, job, { output: "Still idle" });
        assert.equal(db.prepare("SELECT count(*) n FROM runs").get()!.n, 1);
      }),
    );
  }));

test("stale, terminal-blocked and uncertain delivery submissions do not send or replay", () =>
  fixture(async (agent, id, runId) => {
    await report(agent, id, runId);
    const input = feedback(agent, id);
    await run(saveJobFeedback(input));
    const job = await run(getCodingJob(agent, id));
    const submit = {
      agentId: agent,
      id,
      requestId: randomUUID(),
      messageIds: [input.requestId],
      revision: 0,
    };
    await assert.rejects(run(continueJobFeedback(submit)), /changed/);
    await run(
      updateCodingJob(agent, id, {
        lastWorkerState: "blocked",
        status: "blocked",
      }),
    );
    await assert.rejects(
      run(
        continueJobFeedback({
          ...submit,
          revision: (await run(getCodingJob(agent, id))).revision,
        }),
      ),
      /existing worker/,
    );
    await run(
      updateCodingJob(agent, id, { lastWorkerState: "idle", status: "review" }),
    );
    await run(
      continueJobFeedback({
        ...submit,
        revision: (await run(getCodingJob(agent, id))).revision,
      }),
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE coding_job_inputs SET status='failed',error='Uncertain delivery' WHERE id=?",
          )
          .run(submit.requestId),
      ),
    );
    const retry = await run(
      continueJobFeedback({ ...submit, revision: job.revision }),
    );
    assert.equal(retry.status, "failed");
    assert.equal(
      (await run(getJobWorkspace(agent, id))).feedback[0]!.error,
      "Uncertain delivery",
    );
    await assert.rejects(
      run(
        continueJobFeedback({
          ...submit,
          requestId: randomUUID(),
          revision: (await run(getCodingJob(agent, id))).revision,
        }),
      ),
      /already submitted/,
    );
  }));

test("review CTA requires explicit verification, preserves integration distinction; migration leaves core version intact", () =>
  fixture(async (agent, id, runId) => {
    await assert.rejects(
      report(agent, id, runId, { workflow: "review" }),
      /verification evidence/,
    );
    const workspace = await report(agent, id, runId, {
      workflow: "review",
      verification: "Behavior tests passed",
      pullRequests: ["https://github.com/srctl/roost/pull/24"],
    });
    assert.equal(workspace.integration, "pending");
    assert.equal(
      jobWorkflowLabel(await run(getCodingJob(agent, id)), workspace),
      "Ready for review",
    );
    await run(
      withAgentStore((db) => {
        assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 10);
        assert.equal(
          db.prepare("SELECT count(*) n FROM coding_workspace_versions").get()!
            .n,
          1,
        );
      }),
    );
  }));
