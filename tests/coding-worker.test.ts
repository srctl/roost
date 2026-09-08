import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  HerdrError,
  type HerdrWorker,
} from "../src/server/coding/herdr.server";
import {
  continueCodingJob,
  stopCodingJob,
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
import { claimRun, enqueueChat } from "../src/server/runs/store.server";

const run = Effect.runPromise;
const owner = "coding-worker-test";
const signal = () => new AbortController().signal;
const worker = (state: HerdrWorker["state"] = "working"): HerdrWorker => ({
  state,
  output: "Worker output",
  sessionIdentity: "owned-session",
  nativeSessionId: "native-session",
  paneId: "owned-pane",
});

function mockAdapter() {
  const calls = { starts: 0, reads: 0, prompts: 0, stops: 0 };
  const state = { worker: worker() };
  const adapter: typeof codingAdapter = {
    startCodingWorker: async () => {
      calls.starts++;
      return state.worker;
    },
    readCodingWorker: async () => {
      calls.reads++;
      return state.worker;
    },
    promptCodingWorker: async () => {
      calls.prompts++;
      return state.worker;
    },
    stopCodingWorker: async () => {
      calls.stops++;
      return undefined;
    },
  };
  return { calls, state, adapter };
}

async function fixture(task: (agentId: string) => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-coding-worker-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Project",
        kind: "coding",
        instructions: "Develop",
        character: "moss",
        model: "test",
      }),
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare("INSERT INTO worker_lease(id,owner,heartbeat) VALUES(1,?,?)")
          .run(owner, Date.now()),
      ),
    );
    await task(agent.id);
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
}
const create = (agentId: string) =>
  run(
    createCodingJob({
      id: randomUUID(),
      agentId,
      title: "Settings",
      brief: "Implement settings",
      cwd: "/tmp/worktree",
      sessionName: `roost-${randomUUID()}`,
      workerName: `roost-${randomUUID()}`,
      workerKind: "codex",
    }),
  );
const poll = () =>
  run(
    withAgentStore((db) => db.exec("UPDATE coding_jobs SET lastCheckedAt=0")),
  );
const deliveries = (jobId: string) =>
  run(
    withAgentStore((db) =>
      Number(
        db
          .prepare("SELECT COUNT(*) AS n FROM coding_job_updates WHERE jobId=?")
          .get(jobId)?.n,
      ),
    ),
  );

test("coding workers launch once and publish one review update after observed work settles", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    await tickCodingJobs(owner, signal(), mock.adapter);
    const running = await run(getCodingJob(agentId, job.id));
    assert.equal(running.status, "running");
    assert.equal(running.observedWorking, true);
    assert.equal(running.nativeSessionId, "native-session");
    assert.equal(mock.calls.starts, 1);
    mock.state.worker = worker("idle");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    const reviewed = await run(getCodingJob(agentId, job.id));
    assert.equal(reviewed.status, "review");
    assert.equal(reviewed.output, "Worker output");
    assert.equal(await deliveries(job.id), 1);
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(await deliveries(job.id), 1);
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).revision,
      reviewed.revision,
    );
    assert.equal(mock.calls.starts, 1);
  }));

test("idle after a blocked launch is not proof that coding work happened", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    mock.state.worker = worker("blocked");
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).observedWorking,
      false,
    );
    mock.state.worker = worker("idle");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "blocked");
    mock.state.worker = worker("working");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    mock.state.worker = worker("done");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "review");
  }));

test("a missing executable can be fixed and the original launch retried without prompting a nonexistent worker", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    mock.adapter.startCodingWorker = async () => {
      mock.calls.starts++;
      throw new HerdrError("Herdr is not on PATH", "ENOENT", "prepare");
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    const blocked = await run(getCodingJob(agentId, job.id));
    assert.equal(blocked.lastWorkerState, "not_started");
    assert.equal(blocked.dispatchedAt, null);
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.reads, 0);
    assert.equal(mock.calls.starts, 1);
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).error,
      "Herdr is not on PATH",
    );

    const updateRun = await run(claimRun(owner));
    assert.equal(updateRun?.kind, "coding");
    const input = {
      id: job.id,
      requestId: randomUUID(),
      prompt: "Herdr is installed. Resume and include run instructions.",
    };
    const receipt = await run(continueCodingJob(agentId, updateRun!.id, input));
    assert.equal(receipt.status, "launch_queued");
    assert.deepEqual(
      await run(continueCodingJob(agentId, updateRun!.id, input)),
      receipt,
    );
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "queued");
    // Another preparation failure must retain the previous unsent follow-up.
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).lastWorkerState,
      "not_started",
    );
    assert.equal(
      (await run(continueCodingJob(agentId, updateRun!.id, input))).status,
      "launch_failed",
    );
    const nextInput = {
      id: job.id,
      requestId: randomUUID(),
      prompt: "The second dependency is fixed. Resume the assignment.",
    };
    await run(continueCodingJob(agentId, updateRun!.id, nextInput));
    let brief = "";
    mock.adapter.startCodingWorker = async (_target, options) => {
      mock.calls.starts++;
      brief = options.brief;
      return mock.state.worker;
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    const started = await run(getCodingJob(agentId, job.id));
    assert.equal(started.status, "running");
    assert.equal(started.brief, job.brief);
    assert.equal(
      brief,
      `${job.brief}\nFollow-up:\n${input.prompt}\nFollow-up:\n${nextInput.prompt}`,
    );
    assert.equal(mock.calls.starts, 3);
    assert.equal(mock.calls.prompts, 0);
    assert.equal(
      (await run(continueCodingJob(agentId, updateRun!.id, input))).status,
      "sent",
    );
    mock.state.worker = worker("done");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "review");
    assert.equal(mock.calls.starts, 3);
  }));

test("an interrupted launch retry is inspected without replaying its follow-up", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const inputId = randomUUID();
    await run(
      withAgentStore((db) => {
        db.prepare(
          "UPDATE coding_jobs SET status='starting',launchOwner='previous-process' WHERE id=?",
        ).run(job.id);
        db.prepare(
          "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,status,createdAt) VALUES(?,?,?,'Resume original assignment','launching',?)",
        ).run(inputId, job.id, agentId, Date.now());
      }),
    );
    const mock = mockAdapter();
    mock.state.worker = worker("idle");
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.starts, 0);
    assert.equal(mock.calls.prompts, 0);
    assert.notEqual(
      (await run(getCodingJob(agentId, job.id))).lastWorkerState,
      "not_started",
    );
    assert.equal(
      await run(
        withAgentStore(
          (db) =>
            db
              .prepare("SELECT status FROM coding_job_inputs WHERE id=?")
              .get(inputId)?.status,
        ),
      ),
      "failed",
    );
  }));

test("existing workspaces and uncertain preparation failures never enable automatic relaunch", async () =>
  fixture(async (agentId) => {
    for (const failure of [
      new HerdrError("An owned workspace exists", "already_exists", "prepare"),
      new HerdrError(
        "Workspace creation response lost",
        "timeout",
        "prepare",
        true,
      ),
      new HerdrError("Worker launch response lost", "timeout", "launch", true),
    ]) {
      const job = await create(agentId);
      const mock = mockAdapter();
      mock.adapter.startCodingWorker = async () => {
        throw failure;
      };
      await tickCodingJobs(owner, signal(), mock.adapter);
      assert.equal(
        (await run(getCodingJob(agentId, job.id))).status,
        "blocked",
      );
      assert.notEqual(
        (await run(getCodingJob(agentId, job.id))).lastWorkerState,
        "not_started",
      );
    }
  }));

test("uncertain launch failures and restarted launches are inspected without duplicate submission", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    mock.adapter.startCodingWorker = async () => {
      mock.calls.starts++;
      throw new HerdrError(
        "Timed out after submission",
        "timeout",
        "prompt",
        true,
      );
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "blocked");
    mock.state.worker = worker("idle");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.starts, 1);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "blocked");
    const interrupted = await create(agentId);
    await run(
      updateCodingJob(agentId, interrupted.id, {
        status: "starting",
        launchOwner: "previous-process",
      }),
    );
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(
      (await run(getCodingJob(agentId, interrupted.id))).status,
      "blocked",
    );
    assert.equal(mock.calls.starts, 1);
  }));

test("uncertain and interrupted follow-up dispatches are never replayed automatically", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    await run(
      updateCodingJob(agentId, job.id, {
        status: "running",
        sessionIdentity: "owned-session",
        launchOwner: owner,
      }),
    );
    const inputId = randomUUID();
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,createdAt) VALUES(?,?,?,?,?)",
          )
          .run(inputId, job.id, agentId, "Add empty case", Date.now()),
      ),
    );
    const mock = mockAdapter();
    mock.adapter.promptCodingWorker = async () => {
      mock.calls.prompts++;
      throw new HerdrError(
        "Unknown submission outcome",
        "timeout",
        "prompt",
        true,
      );
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(
      await run(
        withAgentStore(
          (db) =>
            db
              .prepare("SELECT status FROM coding_job_inputs WHERE id=?")
              .get(inputId)?.status,
        ),
      ),
      "failed",
    );
    mock.state.worker = worker("idle");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.prompts, 1);
    await run(
      withAgentStore((db) => {
        db.prepare(
          "UPDATE coding_job_inputs SET status='dispatching' WHERE id=?",
        ).run(inputId);
        db.prepare(
          "UPDATE coding_jobs SET launchOwner='previous-process' WHERE id=?",
        ).run(job.id);
      }),
    );
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.prompts, 1);
    assert.equal(
      await run(
        withAgentStore(
          (db) =>
            db
              .prepare("SELECT status FROM coding_job_inputs WHERE id=?")
              .get(inputId)?.status,
        ),
      ),
      "failed",
    );
  }));

test("stop requests wait for observed terminal state and do not repeat interrupts", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    await tickCodingJobs(owner, signal(), mock.adapter);
    await run(stopCodingJob(agentId, job.id));
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.stops, 1);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "running");
    mock.state.worker = worker("idle");
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    const stopped = await run(getCodingJob(agentId, job.id));
    assert.equal(stopped.status, "cancelled");
    assert.equal(mock.calls.stops, 1);
    assert.equal(stopped.cwd, job.cwd);
  }));

test("worker identity changes block a stop and expired leases do not run commands", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    await tickCodingJobs("other-owner", signal(), mock.adapter);
    assert.equal(mock.calls.starts, 0);
    await tickCodingJobs(owner, signal(), mock.adapter);
    await run(stopCodingJob(agentId, job.id));
    mock.state.worker = { ...worker(), sessionIdentity: "different-session" };
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.stops, 0);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "blocked");
  }));

test("a replaced native session blocks cancellation before sending an interrupt", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    await tickCodingJobs(owner, signal(), mock.adapter);
    await run(stopCodingJob(agentId, job.id));
    mock.state.worker = {
      ...worker(),
      nativeSessionId: "replacement-native-session",
    };
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.stops, 0);
    assert.equal((await run(getCodingJob(agentId, job.id))).status, "blocked");
  }));

test("replacement session output cannot confirm that an interrupted worker stopped", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    await tickCodingJobs(owner, signal(), mock.adapter);
    await run(stopCodingJob(agentId, job.id));
    mock.adapter.stopCodingWorker = async () => {
      mock.calls.stops++;
      mock.state.worker = {
        ...worker("idle"),
        nativeSessionId: "replacement-native-session",
        output: "Another session's output",
      };
    };
    await poll();
    await tickCodingJobs(owner, signal(), mock.adapter);
    const result = await run(getCodingJob(agentId, job.id));
    assert.equal(mock.calls.stops, 1);
    assert.equal(result.status, "blocked");
    assert.notEqual(result.output, "Another session's output");
  }));

test("a slow coding launch leaves conversational slots and database writes available", async () =>
  fixture(async (agentId) => {
    await create(agentId);
    const mock = mockAdapter();
    let finish: (value: HerdrWorker) => void = () => {};
    let launched: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      launched = resolve;
    });
    mock.adapter.startCodingWorker = async () => {
      launched();
      return new Promise<HerdrWorker>((resolve) => {
        finish = resolve;
      });
    };
    const ticking = tickCodingJobs(owner, signal(), mock.adapter);
    await entered;
    try {
      await run(
        enqueueChat({
          agentId,
          messageId: randomUUID(),
          text: "Can we discuss the next task?",
        }),
      );
      const chat = await run(claimRun(owner));
      assert.equal(chat?.kind, "chat");
      assert.equal(chat?.agentId, agentId);
    } finally {
      finish(worker());
      await ticking;
    }
  }));

test("cancellation accepted during slow preparation prevents the initial worker prompt", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    let prepared: () => void = () => {};
    let proceed: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    mock.adapter.startCodingWorker = async (_target, options) => {
      mock.calls.starts++;
      prepared();
      await ready;
      assert.ok(options.beforeSend);
      await options.beforeSend();
      mock.calls.prompts++;
      return worker();
    };
    const ticking = tickCodingJobs(owner, signal(), mock.adapter);
    await entered;
    try {
      const stopping = await run(stopCodingJob(agentId, job.id));
      assert.equal(stopping.cancelRequested, true);
    } finally {
      proceed();
      await ticking;
    }
    const result = await run(getCodingJob(agentId, job.id));
    assert.equal(mock.calls.starts, 1);
    assert.equal(mock.calls.prompts, 0);
    assert.equal(result.dispatchedAt, null);
    assert.equal(result.cancelRequested, true);
    assert.equal(result.status, "blocked");
  }));

test("a failed pre-interrupt read keeps cancellation pending for the next healthy tick", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    await tickCodingJobs(owner, signal(), mock.adapter);
    await run(stopCodingJob(agentId, job.id));
    const healthyRead = mock.adapter.readCodingWorker;
    mock.adapter.readCodingWorker = async () => {
      throw new HerdrError("SSH transport unavailable", "transport", "read");
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    const pending = await run(getCodingJob(agentId, job.id));
    assert.equal(pending.cancelRequested, true);
    assert.equal(pending.status, "blocked");
    assert.notEqual(pending.lastWorkerState, "interrupt_sent");
    assert.equal(mock.calls.stops, 0);
    mock.adapter.readCodingWorker = healthyRead;
    mock.adapter.stopCodingWorker = async () => {
      mock.calls.stops++;
      mock.state.worker = worker("idle");
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.stops, 1);
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).status,
      "cancelled",
    );
  }));

test("uncertain interrupt dispatch persists before I/O and subsequent checks never resend it", async () =>
  fixture(async (agentId) => {
    const job = await create(agentId);
    const mock = mockAdapter();
    await tickCodingJobs(owner, signal(), mock.adapter);
    await run(stopCodingJob(agentId, job.id));
    mock.adapter.stopCodingWorker = async () => {
      mock.calls.stops++;
      assert.equal(
        (await run(getCodingJob(agentId, job.id))).lastWorkerState,
        "interrupt_sent",
      );
      throw new HerdrError(
        "Interrupt response was lost",
        "transport",
        "stop",
        true,
      );
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    const uncertain = await run(getCodingJob(agentId, job.id));
    assert.equal(uncertain.cancelRequested, true);
    assert.equal(uncertain.lastWorkerState, "interrupt_sent");
    const healthyRead = mock.adapter.readCodingWorker;
    mock.adapter.readCodingWorker = async () => {
      throw new HerdrError("Still reconnecting", "transport", "read");
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).cancelRequested,
      true,
    );
    mock.adapter.readCodingWorker = healthyRead;
    mock.state.worker = worker("idle");
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.stops, 1);
    assert.equal(
      (await run(getCodingJob(agentId, job.id))).status,
      "cancelled",
    );
  }));

test("a backlog over forty queued jobs cannot starve active monitoring or stop requests", async () =>
  fixture(async (agentId) => {
    for (let index = 0; index < 45; index++) await create(agentId);
    const monitored = [];
    for (let index = 0; index < 4; index++) {
      const job = await create(agentId);
      monitored.push(
        await run(
          updateCodingJob(agentId, job.id, {
            status: "running",
            observedWorking: true,
            sessionIdentity: "owned-session",
            nativeSessionId: "native-session",
          }),
        ),
      );
    }
    const mock = mockAdapter();
    mock.state.worker = worker("idle");
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(mock.calls.starts, 0);
    assert.equal(mock.calls.reads, 4);
    for (const job of monitored)
      assert.equal((await run(getCodingJob(agentId, job.id))).status, "review");

    const stop = monitored[0];
    await run(stopCodingJob(agentId, stop.id));
    const actions: string[] = [];
    mock.adapter.readCodingWorker = async (target) => {
      actions.push(`read:${target.sessionName}`);
      return worker("idle");
    };
    mock.adapter.startCodingWorker = async (target) => {
      actions.push(`start:${target.sessionName}`);
      mock.calls.starts++;
      return worker();
    };
    await tickCodingJobs(owner, signal(), mock.adapter);
    assert.equal(actions[0], `read:${stop.sessionName}`);
    assert.equal(mock.calls.starts, 3);
    assert.equal(mock.calls.stops, 1);
    assert.equal(
      (await run(getCodingJob(agentId, stop.id))).status,
      "cancelled",
    );
  }));
