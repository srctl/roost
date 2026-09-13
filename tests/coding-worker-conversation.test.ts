import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { deleteAgentRecords } from "../src/server/agents/delete.server";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  acknowledgeWorkerFailure,
  sendWorkerMessage,
} from "../src/server/coding/conversation.server";
import {
  HerdrError,
  type HerdrWorker,
} from "../src/server/coding/herdr.server";
import { checkJobPreview } from "../src/server/coding/preview-check.server";
import { responseFrame } from "../src/server/coding/response-capture.server";
import {
  createCodingJob,
  getCodingJob,
  updateCodingJob,
} from "../src/server/coding/store.server";
import {
  type codingAdapter,
  tickCodingJobs,
} from "../src/server/coding/worker.server";
import { getJobWorkspace } from "../src/server/coding/workspace-store.server";

const run = Effect.runPromise;
async function fixture(
  task: (f: {
    agentId: string;
    id: string;
    send: (text: string, requestId?: string) => ReturnType<typeof run>;
    tick: () => Promise<void>;
    state: { worker: HerdrWorker };
    prompts: string[];
    adapter: typeof codingAdapter;
  }) => Promise<void>,
) {
  const directory = mkdtempSync("/tmp/roost-worker-conversation-");
  const prior = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Worker chat",
        kind: "coding",
        instructions: "Do assigned work",
        character: "moss",
        model: "fake",
      }),
    );
    const id = randomUUID();
    await run(
      createCodingJob({
        id,
        agentId: agent.id,
        title: "Task",
        brief: "Original",
        cwd: directory,
        sessionName: "owned",
        workerName: "worker",
        workerKind: "codex",
      }),
    );
    await run(
      updateCodingJob(agent.id, id, {
        status: "running",
        sessionIdentity: "session",
        nativeSessionId: "native",
        lastWorkerState: "working",
        observedWorking: true,
      }),
    );
    const state = {
      worker: {
        state: "working",
        output: "Original output",
        sessionIdentity: "session",
        nativeSessionId: "native",
      } as HerdrWorker,
    };
    const prompts: string[] = [];
    const adapter: typeof codingAdapter = {
      startCodingWorker: async () => {
        throw Error("must never start");
      },
      readCodingWorker: async () => state.worker,
      stopCodingWorker: async () => {},
      promptCodingWorker: async (
        _target,
        _name,
        prompt,
        identity,
        _signal,
        beforeSend,
      ) => {
        assert.equal(identity, "session|session:native");
        await beforeSend?.();
        prompts.push(prompt);
        state.worker = { ...state.worker, state: "working" };
        return state.worker;
      },
    };
    const tick = async () => {
      await run(
        withAgentStore((db) => {
          db.prepare(
            "INSERT INTO worker_lease VALUES(1,'test',?) ON CONFLICT(id) DO UPDATE SET owner='test',heartbeat=excluded.heartbeat",
          ).run(Date.now());
          db.exec("UPDATE coding_jobs SET lastCheckedAt=0");
        }),
      );
      await tickCodingJobs("test", new AbortController().signal, adapter);
    };
    await task({
      agentId: agent.id,
      id,
      send: (text, requestId = randomUUID()) =>
        run(sendWorkerMessage({ agentId: agent.id, id, text, requestId })),
      tick,
      state,
      prompts,
      adapter,
    });
  } finally {
    if (prior === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = prior;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("direct messages bypass occupied main thread, queue while busy, preserve identity and order across reads", () =>
  fixture(async ({ agentId, id, send, tick, state, prompts }) => {
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES(?,?,'chat','main thread held','running',?)",
          )
          .run(randomUUID(), agentId, Date.now()),
      ),
    );
    const first = randomUUID();
    await send("First instruction", first);
    await send("First instruction", first);
    await assert.rejects(send("Different", first), /different worker message/);
    const second = randomUUID();
    await send("Second instruction", second);
    await tick();
    assert.equal(prompts.length, 0);
    assert.deepEqual(
      (await run(getJobWorkspace(agentId, id))).messages.map((m) => m.status),
      ["queued", "queued"],
    );
    state.worker = { ...state.worker, state: "idle" };
    await tick();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /First instruction/);
    await tick();
    assert.equal(prompts.length, 1);
    state.worker = {
      ...state.worker,
      state: "idle",
      output: `Original output\n${responseFrame(first).begin}\nFirst response\n${responseFrame(first).end}`,
    };
    await tick();
    assert.equal(prompts.length, 2);
    assert.match(prompts[1]!, /Second instruction/);
    const read = await run(getJobWorkspace(agentId, id));
    assert.equal(read.messages[0]?.response, "First response");
    assert.equal(read.messages[0]?.status, "answered");
    assert.equal(read.messages[1]?.status, "responding");
    state.worker = {
      ...state.worker,
      state: "idle",
      output: `Original output\nFirst response\n${responseFrame(second).begin}\nSecond response\n${responseFrame(second).end}`,
    };
    await tick();
    await tick();
    assert.equal(prompts.length, 2);
    await run(
      withAgentStore((db) => {
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM coding_jobs").get()!.n,
          1,
        );
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM runs WHERE kind='chat'").get()!.n,
          1,
        );
        assert.equal(
          db
            .prepare(
              "SELECT COUNT(*) n FROM timeline WHERE id LIKE 'worker-response:%'",
            )
            .get()!.n,
          2,
        );
      }),
    );
  }));

test("restart uncertainty fences later instructions until explicit same-worker inspection; retry does not replay", () =>
  fixture(async ({ agentId, id, send, tick, state, prompts }) => {
    const first = randomUUID();
    await send("Uncertain first", first);
    await send("Later");
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE coding_job_inputs SET status='dispatching' WHERE id=?",
          )
          .run(first),
      ),
    );
    state.worker = { ...state.worker, state: "idle" };
    await tick();
    assert.equal(prompts.length, 0);
    assert.equal(
      (await run(getJobWorkspace(agentId, id))).messages[0]?.status,
      "failed",
    );
    await send("Uncertain first", first);
    assert.equal(prompts.length, 0);
    await assert.rejects(send("New"), /Inspect the failed/);
    await run(acknowledgeWorkerFailure(agentId, id, first));
    await tick();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Later/);
    assert.doesNotMatch(prompts[0]!, /Uncertain first/);
  }));

test("approvals hold queued messages; missing or changed worker cannot receive or resume", () =>
  fixture(async ({ agentId, id, send, tick, state, prompts }) => {
    await send("Queued before approval");
    state.worker = { ...state.worker, state: "blocked" };
    await tick();
    assert.equal(prompts.length, 0);
    assert.equal(
      (await run(getJobWorkspace(agentId, id))).messages[0]?.status,
      "queued",
    );
    await assert.rejects(send("bypass"), /Resolve the approval/);
    state.worker = {
      ...state.worker,
      state: "idle",
      nativeSessionId: "replacement",
    };
    await tick();
    assert.equal(prompts.length, 0);
    assert.equal((await run(getCodingJob(agentId, id))).status, "blocked");
    assert.equal(
      (await run(getJobWorkspace(agentId, id))).messages[0]?.status,
      "failed",
    );
  }));

test("busy race is queued without false delivery; lost transport reply is failed and never replayed", () =>
  fixture(async ({ agentId, id, send, tick, state, adapter }) => {
    await send("Race");
    state.worker = { ...state.worker, state: "idle" };
    let calls = 0;
    adapter.promptCodingWorker = async () => {
      calls++;
      throw new HerdrError("became busy", "worker_busy", "prompt");
    };
    await tick();
    assert.equal(
      (await run(getJobWorkspace(agentId, id))).messages[0]?.status,
      "queued",
    );
    adapter.promptCodingWorker = async () => {
      calls++;
      throw new HerdrError("lost reply", "timeout", "prompt", true);
    };
    await tick();
    await tick();
    assert.equal(calls, 2);
    assert.equal(
      (await run(getJobWorkspace(agentId, id))).messages[0]?.status,
      "failed",
    );
  }));

test("main-thread inputs and direct messages share ordering; completed jobs and foreign IDs reject", () =>
  fixture(async ({ agentId, id, send, tick, state, prompts }) => {
    await send("Direct first");
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,status,createdAt) VALUES(?,?,?,'Main second','queued',?)",
          )
          .run(randomUUID(), id, agentId, Date.now() + 1),
      ),
    );
    state.worker = { ...state.worker, state: "idle" };
    await tick();
    assert.match(prompts[0]!, /Direct first/);
    await tick();
    assert.equal(prompts.length, 1);
    state.worker = { ...state.worker, state: "idle", output: "First done" };
    await tick();
    assert.equal(prompts[1], "Main second");
    await assert.rejects(
      run(
        sendWorkerMessage({
          agentId: randomUUID(),
          id,
          requestId: randomUUID(),
          text: "foreign",
        }),
      ),
    );
    await run(updateCodingJob(agentId, id, { status: "completed" }));
    await assert.rejects(send("reopen"), /no available worker/);
  }));

async function server(cwd: string, host = "127.0.0.1", port = 0, status = 200) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `require('http').createServer((q,s)=>{s.writeHead(${status},{location:'http://example.invalid/'});s.end('ok')}).listen(${port},${JSON.stringify(host)},function(){console.log(this.address().port)})`,
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  );
  const [data] = await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => {
      throw new Error("Preview fixture server exited before listening.");
    }),
  ]);
  return { child, port: Number(String(data).trim()) };
}
test("preview verifies actual owned listener and endpoint; stale URL, redirects, wrong bind and unrelated process never prove running", async () => {
  const cwd = mkdtempSync("/tmp/roost-preview-owner-");
  const other = mkdtempSync("/tmp/roost-preview-other-");
  const children: ReturnType<typeof spawn>[] = [];
  try {
    const owned = await server(cwd);
    children.push(owned.child);
    const url = `http://127.0.0.1:${owned.port}/`;
    const check = await checkJobPreview(
      { cwd, remoteTarget: "" },
      url,
      "reported-only",
    );
    assert.equal(check.status, "running");
    assert.match(check.process, /PID/);
    assert.match(check.endpoint, /HTTP 200/);
    assert.equal(check.reportedRevision, "reported-only");
    assert.equal(
      (await checkJobPreview({ cwd, remoteTarget: "" }, url, "", [cwd])).status,
      "unverified",
    );
    assert.ok(check.checkedAt <= Date.now());
    assert.equal(
      (await checkJobPreview({ cwd: other, remoteTarget: "" }, url, "")).status,
      "unverified",
    );
    const redirected = await server(cwd, "127.0.0.1", 0, 302);
    children.push(redirected.child);
    assert.equal(
      (
        await checkJobPreview(
          { cwd, remoteTarget: "" },
          `http://127.0.0.1:${redirected.port}/`,
          "",
        )
      ).status,
      "unavailable",
    );
    const wrong = await server(cwd, "127.0.0.2");
    children.push(wrong.child);
    const unrelated = await server(other, "127.0.0.1", wrong.port);
    children.push(unrelated.child);
    assert.equal(
      (
        await checkJobPreview(
          { cwd, remoteTarget: "" },
          `http://127.0.0.1:${wrong.port}/`,
          "",
        )
      ).status,
      "unverified",
    );
    owned.child.kill();
    await once(owned.child, "exit");
    assert.equal(
      (await checkJobPreview({ cwd, remoteTarget: "" }, url, "")).status,
      "unavailable",
    );
    assert.equal(
      (await checkJobPreview({ cwd, remoteTarget: "host" }, url, "")).status,
      "unverified",
    );
    assert.equal(
      (
        await checkJobPreview(
          { cwd, remoteTarget: "" },
          "https://example.invalid",
          "",
        )
      ).status,
      "unverified",
    );
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

for (const workflow of ["review", "feedback"] as const)
  test(`preview status preserves ${workflow} fields without starting services`, () =>
    fixture(async ({ agentId, id, send, tick, state, prompts }) => {
      const { writeCodingWorkspace, readCodingWorkspace } = await import(
        "../src/server/coding/workspace-store.server"
      );
      await run(
        updateCodingJob(agentId, id, {
          status: "review",
          lastWorkerState: "idle",
        }),
      );
      await run(
        withAgentStore((db) =>
          writeCodingWorkspace(db, {
            ...readCodingWorkspace(db, agentId, id),
            workflow,
            verification: "Existing evidence",
            integration: "verified",
            previewUrl: "https://example.invalid/preview",
            previewRevision: "old-revision",
            previewAvailability: "running",
            previewReportedAt: 1,
            previewExpiresAt: 2,
          }),
        ),
      );
      await send("is the dev server running for this preview?");
      state.worker = { ...state.worker, state: "idle" };
      await tick();
      assert.equal(prompts.length, 1);
      assert.match(prompts[0]!, /MUST NOT start, restart, refresh/);
      const saved = await run(getJobWorkspace(agentId, id));
      assert.equal(saved.workspace.workflow, workflow);
      assert.equal(saved.workspace.previewRevision, "old-revision");
      assert.equal(saved.workspace.previewExpiresAt, 2);
      assert.equal(saved.workspace.verification, "Existing evidence");
      assert.equal(saved.workspace.integration, "verified");
      assert.equal(
        JSON.parse(saved.messages[0]!.previewCheck).status,
        "unverified",
      );
      assert.equal((await run(getCodingJob(agentId, id))).status, "running");
    }));

test("an uncertain concurrent coordinator input fences direct messages without replaying old unrelated failures", () =>
  fixture(async ({ agentId, id, send, tick, state, adapter, prompts }) => {
    const legacy = randomUUID();
    await run(
      withAgentStore((db) => {
        db.prepare(
          "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,status,createdAt) VALUES(?,?,?,'old failure','failed',0)",
        ).run(randomUUID(), id, agentId);
        db.prepare(
          "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,status,createdAt) VALUES(?,?,?,'Coordinator instruction','queued',1)",
        ).run(legacy, id, agentId);
      }),
    );
    await send("Direct instruction after coordinator");
    state.worker = { ...state.worker, state: "idle" };
    const normal = adapter.promptCodingWorker;
    adapter.promptCodingWorker = async () => {
      throw new HerdrError("lost coordinator reply", "timeout", "prompt", true);
    };
    await tick();
    await tick();
    assert.equal(prompts.length, 0);
    assert.deepEqual((await run(getJobWorkspace(agentId, id))).queueBlockers, [
      legacy,
    ]);
    await run(acknowledgeWorkerFailure(agentId, id, legacy));
    adapter.promptCodingWorker = normal;
    await tick();
    assert.equal(prompts.length, 1);
    assert.match(prompts[0]!, /Direct instruction after coordinator/);
  }));

test("an explicit instruction resumes feedback pause while retaining same worker", () =>
  fixture(async ({ agentId, id, send, tick, state, prompts }) => {
    const { writeCodingWorkspace, readCodingWorkspace } = await import(
      "../src/server/coding/workspace-store.server"
    );
    await run(
      updateCodingJob(agentId, id, {
        status: "review",
        lastWorkerState: "idle",
      }),
    );
    await run(
      withAgentStore((db) =>
        writeCodingWorkspace(db, {
          ...readCodingWorkspace(db, agentId, id),
          workflow: "feedback",
        }),
      ),
    );
    await send("Continue implementing the requested fix");
    assert.equal(
      (await run(getJobWorkspace(agentId, id))).workspace.workflow,
      "working",
    );
    state.worker = { ...state.worker, state: "idle" };
    await tick();
    assert.equal(prompts.length, 1);
    assert.equal(
      (await run(getCodingJob(agentId, id))).sessionIdentity,
      "session",
    );
  }));

test("terminal redraw or prompt echo cannot become a worker answer; completed delivery survives reconnect without replay", () =>
  fixture(async ({ agentId, id, send, tick, state, prompts }) => {
    await send("Read-only question");
    state.worker = { ...state.worker, state: "idle" };
    await tick();
    state.worker = {
      ...state.worker,
      state: "idle",
      output: `Old answer\n› Task:\n${prompts[0]}\n›`,
    };
    await tick();
    const read = await run(getJobWorkspace(agentId, id));
    assert.equal(read.messages[0]?.status, "response_unavailable");
    assert.match(read.messages[0]!.response, /could not be safely isolated/);
    assert.doesNotMatch(
      read.messages[0]!.response,
      /Old answer|Read-only question|ROOST_REPLY/,
    );
    await tick();
    assert.equal(prompts.length, 1);
    assert.equal(
      (await run(getJobWorkspace(agentId, id))).messages[0]?.status,
      "response_unavailable",
    );
    await send("Next instruction");
    await tick();
    assert.equal(prompts.length, 2);
  }));

test("deletion during a stale worker observation cannot dispatch or recreate job conversation records", async () =>
  fixture(async ({ agentId, id, adapter, tick, state, prompts }) => {
    adapter.readCodingWorker = async () => {
      await run(updateCodingJob(agentId, id, { status: "completed" }));
      await run(deleteAgentRecords({ agentId, name: "Worker chat" }));
      return { ...state.worker, state: "idle" };
    };
    await tick();
    assert.deepEqual(prompts, []);
    await run(
      withAgentStore((db) => {
        for (const table of [
          "agents",
          "coding_jobs",
          "conversation_records",
          "timeline",
          "coding_worker_messages",
        ])
          assert.equal(
            db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n,
            0,
            table,
          );
        assert.equal(
          db.prepare("SELECT id FROM deleted_agents").get()?.id,
          agentId,
        );
      }),
    );
  }));
