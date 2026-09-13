import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  PREVIEW_REPORT_TTL_MS,
  previewState,
} from "../src/features/coding/workspace-schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import {
  changeCodingJob,
  continueCodingJob,
  requireCodingRun,
} from "../src/server/coding/jobs.server";
import {
  createCodingJob,
  getCodingJob,
  updateCodingJob,
} from "../src/server/coding/store.server";
import {
  continueJobFeedback,
  reportCodingWorkspace,
} from "../src/server/coding/workspace.server";
import {
  getJobWorkspace,
  saveJobFeedback,
  writeCodingWorkspace,
} from "../src/server/coding/workspace-store.server";
import { readRunAttention } from "../src/server/notifications/push.server";
import { notifyAgent } from "../src/server/notifications/tools.server";
import { enqueueChat, listRuns } from "../src/server/runs/store.server";
import {
  deleteReplyThread,
  readSharedContext,
} from "../src/server/runs/threads.server";
import { putMessage, readTimeline } from "../src/server/runs/timeline.server";
import { startWorker } from "../src/server/runs/worker.server";

const run = Effect.runPromise;
async function fixture(
  task: (
    agent: string,
    id: string,
    source: string,
    directory: string,
  ) => Promise<void>,
) {
  const directory = mkdtempSync("/tmp/roost-job-discussion-test-");
  const before = {
    dir: process.env.ROOST_DATA_DIR,
    home: process.env.CODEX_HOME,
    binary: process.env.ROOST_CODEX_BINARY,
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
    const agent = randomUUID(),
      id = randomUUID(),
      source = randomUUID();
    await run(
      saveAgent({
        id: agent,
        name: "Test",
        kind: "coding",
        instructions: "Original assignment authorization",
        character: "moss",
        model: "fake",
      }),
    );
    await run(
      withAgentStore((db) => {
        db.prepare(
          "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES(?,?,'chat','Original task','completed',?)",
        ).run(source, agent, Date.now());
        putMessage(db, agent, {
          id: source,
          role: "user",
          text: "Original task decision",
        });
        db.prepare("INSERT INTO timeline_imports VALUES(?)").run(agent);
        db.exec("UPDATE agent_reflections SET nextRunAt=NULL");
      }),
    );
    await run(
      createCodingJob({
        id,
        agentId: agent,
        sourceRunId: source,
        title: "Original job",
        brief: "Original authorization",
        cwd: directory,
        sessionName: "owned",
        workerName: "owned",
        workerKind: "codex",
      }),
    );
    await run(
      updateCodingJob(agent, id, {
        status: "review",
        sessionIdentity: "owned-session",
        nativeSessionId: "native-session",
        lastWorkerState: "idle",
        observedWorking: true,
        lastCheckedAt: Date.now() + 60_000,
      }),
    );
    await task(agent, id, source, directory);
  } finally {
    await closeAgentRuntimes();
    for (const [key, value] of [
      ["ROOST_DATA_DIR", before.dir],
      ["CODEX_HOME", before.home],
      ["ROOST_CODEX_BINARY", before.binary],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
const feedback = (agentId: string, id: string) => ({
  agentId,
  id,
  requestId: randomUUID(),
  text: "Keep the compact layout",
  previewRevision: "r06",
});
async function report(agent: string, id: string, source: string) {
  await run(
    withAgentStore((db) =>
      db.prepare("UPDATE runs SET status='running' WHERE id=?").run(source),
    ),
  );
  const { workspace } = await run(getJobWorkspace(agent, id));
  return run(
    reportCodingWorkspace(agent, source, {
      ...workspace,
      id,
      workflow: "feedback",
      previewUrl: "https://example.com/private",
      previewAvailability: "running",
      previewRevision: "r06",
    }),
  );
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Fixture worker timed out");
}

test("real chat worker replies and notifications remain in job; shared retrieval preserves agent awareness", () =>
  fixture(async (agent, id, source, directory) => {
    const input = feedback(agent, id);
    await run(saveJobFeedback(input));
    const chat = {
      agentId: agent,
      conversationId: id,
      messageId: randomUUID(),
      text: "shared-context",
    };
    await run(enqueueChat(chat));
    await run(enqueueChat(chat));
    const stop = startWorker();
    try {
      await until(
        async () =>
          (await run(listRuns(agent))).find((r) => r.id === chat.messageId)
            ?.status === "completed",
      );
      const messages = await run(readTimeline(agent, id));
      assert.equal(messages.filter((m) => m.id === chat.messageId).length, 1);
      assert.ok(
        messages.some(
          (m) => m.role === "assistant" && m.text.includes("Original task"),
        ),
      );
      const main = await run(readTimeline(agent));
      assert.deepEqual(
        main.map((m) => m.id),
        [source],
      );
      const attention = await run(readRunAttention(chat.messageId));
      assert.equal(attention?.conversationId, id);
      const shared = await run(
        readSharedContext(agent, { conversationId: id }),
      );
      assert.ok(shared.entries.some((m) => m.id === input.requestId));
      assert.ok(shared.entries.every((m) => m.conversationId === id));
    } finally {
      await stop();
    }
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE runs SET status='running' WHERE id=?")
          .run(chat.messageId),
      ),
    );
    const notice = await run(
      notifyAgent(
        agent,
        chat.messageId,
        {
          requestId: randomUUID(),
          title: "Job feedback received",
          body: "I will keep the compact layout.",
        },
        { directory },
      ),
    );
    assert.ok(notice.recorded);
    assert.ok(
      (await run(readTimeline(agent, id))).some(
        (m) => m.title === "Job feedback received",
      ),
    );
    assert.equal((await run(readTimeline(agent))).length, 1);
    const job = await run(getCodingJob(agent, id));
    assert.equal(job.sourceRunId, source);
    assert.equal(job.sessionIdentity, "owned-session");
  }));

test("only a new turn in this job can release feedback pause; deleted discussion never reroutes or resumes", () =>
  fixture(async (agent, id, source) => {
    await report(agent, id, source);
    const input = feedback(agent, id);
    await run(saveJobFeedback(input));
    const continuation = {
      id,
      requestId: randomUUID(),
      prompt: "Apply my feedback",
    };
    await assert.rejects(
      run(continueCodingJob(agent, source, continuation)),
      /job discussion/,
    );
    const chat = randomUUID();
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(source);
        db.prepare(
          "INSERT INTO runs(id,agentId,conversationId,kind,prompt,status,createdAt) VALUES(?,?,?,'chat','Apply feedback','running',?)",
        ).run(chat, agent, id, Date.now());
        assert.throws(
          () => requireCodingRun(db, agent, chat, "start"),
          /existing assignment/,
        );
        assert.throws(
          () => requireCodingRun(db, agent, chat, "continue", randomUUID()),
          /existing assignment/,
        );
      }),
    );
    await run(continueCodingJob(agent, chat, continuation));
    assert.equal((await run(getCodingJob(agent, id))).sourceRunId, source);
    await run(deleteReplyThread(agent, id));
    await assert.rejects(
      run(saveJobFeedback(feedback(agent, id))),
      /Conversation not found/,
    );
    await assert.rejects(
      run(
        enqueueChat({
          agentId: agent,
          conversationId: id,
          messageId: randomUUID(),
          text: "Retry",
        }),
      ),
      /Conversation not found/,
    );
    await assert.rejects(
      run(
        continueJobFeedback({
          agentId: agent,
          id,
          requestId: randomUUID(),
          revision: (await run(getCodingJob(agent, id))).revision,
          messageIds: [input.requestId],
        }),
      ),
      /Conversation not found/,
    );
    const deletedJob = await run(getCodingJob(agent, id));
    await run(
      withAgentStore((db) => {
        const count = db.prepare("SELECT count(*) n FROM runs").get()!.n;
        changeCodingJob(db, deletedJob, { status: "blocked" });
        assert.equal(db.prepare("SELECT count(*) n FROM runs").get()!.n, count);
      }),
    );
  }));

test("running reports expire at a bounded deadline; unrelated writes cannot renew or change execution", () =>
  fixture(async (agent, id, source) => {
    const w = await report(agent, id, source);
    assert.equal(
      w.previewExpiresAt - w.previewReportedAt,
      PREVIEW_REPORT_TTL_MS,
    );
    assert.equal(previewState(w, w.previewExpiresAt - 1), "running");
    assert.equal(previewState(w, w.previewExpiresAt), "unknown");
    assert.equal(
      previewState({ ...w, previewReportedAt: 0, previewExpiresAt: 0 }),
      "unknown",
    );
    assert.equal(
      previewState({ ...w, previewExpiresAt: w.previewExpiresAt + 1 }),
      "unknown",
    );
    assert.equal(previewState(w, w.previewReportedAt - 1), "unknown");
    const changed = await run(
      withAgentStore((db) =>
        writeCodingWorkspace(db, { ...w, latestChanges: "Unrelated report" }),
      ),
    );
    assert.equal(changed.previewExpiresAt, w.previewExpiresAt);
    assert.equal((await run(getCodingJob(agent, id))).status, "review");
  }));

for (const core of [10, 13])
  test(`aggregate upgrade from core ${core}/workspace v1 preserves identities, moves only saved job feedback, repeats safely`, () =>
    fixture(async (agent, id, source) => {
      await report(agent, id, source);
      const input = feedback(agent, id);
      await run(saveJobFeedback(input));
      const before = await run(getCodingJob(agent, id));
      await run(
        withAgentStore((db) => {
          db.prepare(
            "UPDATE timeline SET conversationId=agentId WHERE id=?",
          ).run(input.requestId);
          db.prepare(
            "UPDATE coding_job_workspaces SET conversationId=agentId WHERE jobId=?",
          ).run(id);
          db.exec("DELETE FROM coding_workspace_versions WHERE version=2");
          db.exec(
            `DROP TABLE agent_notes; DROP TABLE note_revisions; DROP TABLE note_requests; DROP TABLE note_reads; PRAGMA user_version=${core}`,
          );
          if (core === 10)
            db.exec(
              `${readFileSync(
                new URL("./fixtures/remove-thread-schema.sql", import.meta.url),
                "utf8",
              )};PRAGMA user_version=10`,
            );
          else {
            db.exec("PRAGMA user_version=13");
            db.prepare("DELETE FROM conversation_records WHERE id=?").run(id);
          }
        }),
      );
      for (let i = 0; i < 2; i++) {
        const saved = await run(getJobWorkspace(agent, id));
        assert.equal(saved.workspace.conversationId, id);
        assert.equal(saved.feedback[0]!.id, input.requestId);
        assert.equal(saved.feedback[0]!.inputId, null);
        assert.equal(saved.workspace.previewRevision, "r06");
        assert.equal(
          (await run(readTimeline(agent))).some(
            (m) => m.id === input.requestId,
          ),
          false,
        );
        assert.deepEqual(await run(getCodingJob(agent, id)), before);
        await run(
          withAgentStore((db) => {
            assert.equal(
              db.prepare("PRAGMA user_version").get()!.user_version,
              14,
            );
            assert.equal(
              db
                .prepare("SELECT MAX(version) v FROM coding_workspace_versions")
                .get()!.v,
              2,
            );
            assert.equal(
              db
                .prepare("SELECT conversationId FROM runs WHERE id=?")
                .get(source)!.conversationId,
              agent,
            );
            assert.equal(
              db.prepare("SELECT count(*) n FROM coding_jobs").get()!.n,
              1,
            );
          }),
        );
      }
    }));

for (const core of [10, 13])
  test(`upgrade from core ${core} fences active reports before core changes and reroutes queued reports without replay`, () =>
    fixture(async (agent, id, source, directory) => {
      const update = randomUUID();
      await run(
        withAgentStore((db) => {
          db.prepare(
            "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES(?,?,'coding','Worker report','running',?)",
          ).run(update, agent, Date.now());
          db.prepare("INSERT INTO coding_job_updates VALUES(?,?,?)").run(
            update,
            id,
            agent,
          );
          putMessage(db, agent, {
            id: update,
            role: "notice",
            text: "Worker report",
            title: "Ready",
          });
          db.exec("DELETE FROM coding_workspace_versions WHERE version=2");
          db.prepare("DELETE FROM conversation_records WHERE id=?").run(id);
          db.exec(
            `DROP TABLE agent_notes; DROP TABLE note_revisions; DROP TABLE note_requests; DROP TABLE note_reads; PRAGMA user_version=${core}`,
          );
          if (core === 10)
            db.exec(
              `${readFileSync(new URL("./fixtures/remove-thread-schema.sql", import.meta.url), "utf8")};PRAGMA user_version=10`,
            );
        }),
      );
      await assert.rejects(
        run(getJobWorkspace(agent, id)),
        /Finish or stop active coding report turns/,
      );
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(join(directory, "roost.sqlite"));
      try {
        assert.equal(
          db.prepare("PRAGMA user_version").get()!.user_version,
          core,
        );
        assert.equal(
          db
            .prepare("SELECT MAX(version) v FROM coding_workspace_versions")
            .get()!.v,
          1,
        );
        db.prepare("UPDATE runs SET status='queued' WHERE id=?").run(update);
      } finally {
        db.close();
      }
      await run(getJobWorkspace(agent, id));
      await run(
        withAgentStore((db) => {
          assert.equal(
            db
              .prepare("SELECT conversationId FROM runs WHERE id=?")
              .get(update)!.conversationId,
            id,
          );
          assert.equal(
            db
              .prepare("SELECT conversationId FROM timeline WHERE id=?")
              .get(update)!.conversationId,
            id,
          );
          assert.equal(db.prepare("SELECT count(*) n FROM runs").get()!.n, 2);
          assert.equal(
            db
              .prepare("SELECT conversationId FROM runs WHERE id=?")
              .get(source)!.conversationId,
            agent,
          );
        }),
      );
    }));
