import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { deleteAgentRecords } from "../src/server/agents/delete.server";
import {
  listAgents,
  saveAgent,
  withAgentStore,
} from "../src/server/agents/store.server";
import { deleteAgent } from "../src/server/codex/agent-runtime.server";
import { createCodingJob } from "../src/server/coding/store.server";
import { tickCodingJobs } from "../src/server/coding/worker.server";
import { readConversationSnapshot } from "../src/server/runs/conversation-snapshot.server";
import {
  cancelRun,
  claimRun,
  enqueueChat,
  finishRun,
  schedulerTick,
} from "../src/server/runs/store.server";

const run = Effect.runPromise;
async function fixture(
  task: (f: {
    directory: string;
    id: string;
    other: string;
    remove: () => ReturnType<typeof run<void, unknown>>;
  }) => Promise<void>,
) {
  const directory = mkdtempSync("/tmp/roost-delete-test-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const id = randomUUID(),
    other = randomUUID();
  try {
    for (const [agentId, name] of [
      [id, "Scout"],
      [other, "River"],
    ])
      await run(
        saveAgent({
          id: agentId!,
          name: name!,
          instructions: "Help",
          character: "moss",
          model: "test",
          kind: "coding",
        }),
      );
    await task({
      directory,
      id,
      other,
      remove: () => run(deleteAgentRecords({ agentId: id, name: "Scout" })),
    });
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
}
const store = <A>(fn: Parameters<typeof withAgentStore<A>>[0]) =>
  run(withAgentStore(fn));
const job = (agentId: string) =>
  run(
    createCodingJob({
      id: randomUUID(),
      agentId,
      title: "Fixture job",
      brief: "Isolated fixture only",
      cwd: "/tmp/fixture-worktree",
      sessionName: "fixture",
      workerName: "fixture",
      workerKind: "codex",
    }),
  );

test("deletion removes owned records atomically, retains disk/shared data, fences retries and never schedules again", async () =>
  fixture(async ({ directory, id, other, remove }) => {
    const filePaths = [
      join(directory, "agents", id, "codex", "memory.md"),
      join(directory, "workspaces", id, "keep.txt"),
      join(directory, "files", "keep.bin"),
    ];
    for (const path of filePaths) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "retained");
    }
    await run(
      enqueueChat({ agentId: id, messageId: randomUUID(), text: "Queued" }),
    );
    await job(id);
    await store((db) => {
      for (const a of [id, other]) {
        db.prepare("INSERT INTO conversations VALUES (?,?)").run(
          a,
          "shared-thread",
        );
        db.prepare("INSERT INTO agent_sessions VALUES (?,?,'[]')").run(
          a,
          "shared-thread",
        );
        db.prepare("INSERT INTO timeline_imports VALUES (?)").run(a);
        db.prepare(
          "INSERT INTO automations(id,agentId,name,prompt,schedule,notification,revision,enabled,nextRunAt) VALUES (?,?,'Daily','Check','{\"kind\":\"interval\",\"minutes\":60}','when-needed',1,0,NULL)",
        ).run(randomUUID(), a);
        db.prepare(
          "INSERT INTO dashboards VALUES (?,'board','Board','[]',1,0)",
        ).run(a);
        db.prepare(
          "INSERT INTO dashboard_datasets VALUES (?,'data','{}',1,0)",
        ).run(a);
        db.prepare(
          "INSERT INTO files VALUES (?,?,NULL,'file','text/plain',8,'attachment',0)",
        ).run(randomUUID(), a);
        db.prepare(
          "INSERT INTO soul_changes VALUES (?,?,'user','reason','old','new','1','2','today')",
        ).run(randomUUID(), a);
        db.prepare(
          "INSERT INTO approvals VALUES (?,?,?,'thread','key','{}','pending',NULL,0,NULL)",
        ).run(randomUUID(), a, randomUUID());
        db.prepare(
          "INSERT INTO agent_notifications VALUES (?,?,?,'request','Title','Body',0)",
        ).run(randomUUID(), a, randomUUID());
        db.prepare("INSERT INTO agent_reflections VALUES (?,0,NULL,0)").run(a);
      }
      db.prepare(
        "INSERT INTO conversation_instructions VALUES ('shared-thread','Keep')",
      ).run();
      db.prepare(
        "INSERT INTO coding_profiles VALUES (?,'Shared','local','','',1)",
      ).run(randomUUID());
    });
    const tables = [
      "conversations",
      "agent_sessions",
      "timeline_imports",
      "automations",
      "dashboards",
      "dashboard_datasets",
      "files",
      "soul_changes",
      "approvals",
      "agent_notifications",
      "agent_reflections",
    ];
    const before = await store((db) =>
      tables.map((t) =>
        db.prepare(`SELECT * FROM ${t} WHERE agentId=?`).all(other),
      ),
    );
    await remove();
    await remove();
    assert.deepEqual(
      (await run(listAgents())).map((a) => a.id),
      [other],
    );
    await store((db) => {
      for (const t of [
        ...tables,
        "runs",
        "timeline",
        "coding_jobs",
        "coding_settings",
        "coding_job_inputs",
        "coding_job_updates",
      ])
        assert.equal(
          db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE agentId=?`).get(id)
            ?.n,
          0,
          t,
        );
      assert.deepEqual(
        tables.map((t) =>
          db.prepare(`SELECT * FROM ${t} WHERE agentId=?`).all(other),
        ),
        before,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM coding_profiles").get()?.n,
        1,
      );
      assert.equal(
        db.prepare("SELECT instructions FROM conversation_instructions").get()
          ?.instructions,
        "Keep",
      );
      assert.throws(
        () =>
          db
            .prepare("INSERT INTO agent_sessions VALUES (?,'stale','[]')")
            .run(id),
        /deleted/,
      );
      assert.throws(
        () =>
          db
            .prepare(
              "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES (?,?,'coding','stale','queued',0)",
            )
            .run(randomUUID(), id),
        /deleted/,
      );
    });
    for (const path of filePaths)
      assert.equal(readFileSync(path, "utf8"), "retained");
    await assert.rejects(
      run(
        saveAgent({
          id,
          name: "Scout",
          instructions: "Help",
          character: "moss",
          model: "test",
        }),
      ),
      /deleted/,
    );
    await assert.rejects(
      run(
        enqueueChat({
          agentId: id,
          messageId: randomUUID(),
          text: "Stale tab",
        }),
      ),
      /not found/,
    );
    await assert.rejects(run(readConversationSnapshot(id)), /not found/);
    await run(schedulerTick("fixture-worker"));
    assert.equal(await run(claimRun("fixture-worker")), undefined);
    const unexpected = async () => {
      throw new Error("Deleted job must not call a worker");
    };
    await tickCodingJobs("fixture-worker", new AbortController().signal, {
      startCodingWorker: unexpected,
      readCodingWorker: unexpected,
      promptCodingWorker: unexpected,
      stopCodingWorker: unexpected,
    });
  }));

test("active turn and stop request block deletion until worker finishes; queued work is then discarded", async () =>
  fixture(async ({ id, remove }) => {
    await run(schedulerTick("fixture-worker"));
    const first = randomUUID();
    await run(enqueueChat({ agentId: id, messageId: first, text: "Run" }));
    const active = await run(claimRun("fixture-worker"));
    assert.ok(active);
    await run(
      enqueueChat({ agentId: id, messageId: randomUUID(), text: "Follow-up" }),
    );
    await assert.rejects(remove(), /active turn/);
    await run(cancelRun(id, first));
    await assert.rejects(remove(), /active turn/);
    assert.equal((await run(listAgents())).length, 2);
    await run(finishRun(active, "cancelled", []));
    await remove();
    assert.equal(await run(claimRun("fixture-worker")), undefined);
  }));

test("coding starting/running/blocked/review/failed jobs and uncertain stops prevent deletion", async () =>
  fixture(async ({ id, remove }) => {
    const created = await job(id);
    for (const status of [
      "starting",
      "running",
      "blocked",
      "review",
      "failed",
    ]) {
      await store((db) =>
        db
          .prepare(
            "UPDATE coding_jobs SET status=?,cancelRequested=1 WHERE id=?",
          )
          .run(status, created.id),
      );
      await assert.rejects(remove(), /coding worker/);
      assert.equal((await run(listAgents())).length, 2);
    }
    await store((db) =>
      db
        .prepare("UPDATE coding_jobs SET status='cancelled' WHERE id=?")
        .run(created.id),
    );
    await remove();
  }));

test("safe prelaunch failure can be deleted and no failed launch is retried", async () =>
  fixture(async ({ id, remove }) => {
    const created = await job(id);
    await store((db) =>
      db
        .prepare(
          "UPDATE coding_jobs SET status='blocked',lastWorkerState='not_started' WHERE id=?",
        )
        .run(created.id),
    );
    await remove();
  }));

test("outstanding delegated work on another agent is preserved and blocks deletion", async () =>
  fixture(async ({ id, other, remove }) => {
    const task = randomUUID();
    await store((db) => {
      db.prepare(
        "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES (?,?,'delegation','Work','queued',0)",
      ).run(task, other);
      db.prepare("INSERT INTO delegations VALUES (?,?,?,?,'Task',NULL)").run(
        task,
        id,
        randomUUID(),
        other,
      );
    });
    await assert.rejects(remove(), /delegated task/);
    await store((db) =>
      db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(task),
    );
    await remove();
    assert.equal(
      await store(
        (db) =>
          db.prepare("SELECT status FROM runs WHERE id=?").get(task)?.status,
      ),
      "completed",
    );
  }));

test("storage failure rolls back all removal; mismatched confirmation and maintenance are rejected", async () =>
  fixture(async ({ id, remove }) => {
    await assert.rejects(
      run(deleteAgentRecords({ agentId: id, name: "Wrong" })),
      /changed/,
    );
    await store((db) => db.exec("UPDATE runtime_control SET maintenance=1"));
    await assert.rejects(remove());
    await store((db) => {
      db.exec("UPDATE runtime_control SET maintenance=0");
      db.prepare(
        "INSERT INTO files VALUES (?,?,NULL,'file','text/plain',0,'artifact',0)",
      ).run(randomUUID(), id);
      db.exec(
        "CREATE TRIGGER fixture_failure BEFORE DELETE ON files BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
      );
    });
    await assert.rejects(remove(), /storage/);
    assert.equal((await run(listAgents())).length, 2);
    assert.equal(
      await store(
        (db) => db.prepare("SELECT COUNT(*) AS n FROM deleted_agents").get()?.n,
      ),
      0,
    );
    await store((db) => db.exec("DROP TRIGGER fixture_failure"));
    await remove();
  }));

test("runtime disposal must succeed before deletion, busy runtimes block and idle runtime is closed", async () =>
  fixture(async ({ directory, id }) => {
    const globals = globalThis as typeof globalThis & {
      roostAgentRuntimes: Map<string, unknown>;
    };
    const home = join(directory, "agents", id, "codex");
    let closed = 0;
    const remove = () => run(deleteAgent({ agentId: id, name: "Scout" }));
    globals.roostAgentRuntimes.set(home, { users: 1 });
    await assert.rejects(remove(), /busy/);
    globals.roostAgentRuntimes.set(home, {
      users: 0,
      runtime: {
        dispose: async () => {
          throw new Error("fixture close failed");
        },
      },
    });
    await assert.rejects(remove(), /Could not delete/);
    assert.equal((await run(listAgents())).length, 2);
    globals.roostAgentRuntimes.set(home, {
      users: 0,
      runtime: {
        dispose: async () => {
          closed++;
        },
      },
    });
    await remove();
    assert.equal(closed, 1);
    assert.equal(globals.roostAgentRuntimes.has(home), false);
    assert.ok(existsSync(join(directory, "workspaces", id)));
  }));
