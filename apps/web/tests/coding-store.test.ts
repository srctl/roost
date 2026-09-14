import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import type {
  CodingJobPatch,
  ExecutionProfile,
} from "../src/features/coding/schema";
import {
  listSoulChanges,
  readSoul,
  undoSoulChange,
  updateSoul,
} from "../src/server/agents/soul.server";
import {
  listAgents,
  saveAgent,
  withAgentStore,
} from "../src/server/agents/store.server";
import {
  createCodingJob,
  deleteExecutionProfile,
  getCodingJob,
  getCodingSettings,
  listCodingJobs,
  listExecutionProfiles,
  readCodingJob,
  saveCodingSettings,
  saveExecutionProfile,
  updateCodingJob,
  writeCodingJobPatch,
} from "../src/server/coding/store.server";
import { readReflection } from "../src/server/reflections/store.server";
import { writeTransaction } from "../src/server/transaction.server";

const run = Effect.runPromise;
const agentInput = (kind: "assistant" | "coding" = "coding") => ({
  id: randomUUID(),
  name: "Project companion",
  instructions: "Help me develop this project.",
  character: "moss" as const,
  model: "test",
  kind,
});
const profileInput = (): ExecutionProfile => ({
  id: randomUUID(),
  name: "Development Mac",
  kind: "local",
  target: "",
  instructions: "Create a new worktree and run the project checks.",
  revision: 0,
});
const jobInput = (agentId: string) => ({
  id: randomUUID(),
  agentId,
  title: "Implement settings",
  brief: "Implement the settings screen and verify the result.",
  cwd: "/tmp/project-worktree",
  sessionName: "project-settings",
  workerName: "developer",
  workerKind: "codex",
});

async function fixture(task: () => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-coding-store-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    await task();
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("legacy agents default to assistant and coding identity retains soul updates, undo and reflection", async () =>
  fixture(async () => {
    const { kind: _kind, ...legacyInput } = agentInput();
    const legacy = await run(saveAgent(legacyInput));
    assert.equal(legacy.kind, "assistant");
    assert.deepEqual(await run(saveAgent(legacyInput)), legacy);
    await assert.rejects(
      run(saveAgent({ ...legacyInput, kind: "coding" })),
      /already used/,
    );
    const coding = await run(saveAgent(agentInput()));
    assert.equal(coding.kind, "coding");
    assert.deepEqual(
      (await run(listAgents())).find((item) => item.id === coding.id),
      coding,
    );
    const soul = await run(readSoul(coding.id));
    await run(
      updateSoul(
        {
          agentId: coding.id,
          revision: soul.revision,
          content: `${soul.content}\nBe concise in progress updates.`,
          reason: "User prefers concise updates.",
        },
        "agent",
      ),
    );
    assert.match((await run(readSoul(coding.id))).content, /Be concise/);
    await run(
      undoSoulChange(coding.id, (await run(listSoulChanges(coding.id)))[0].id),
    );
    assert.equal((await run(readSoul(coding.id))).content, soul.content);
    assert.equal((await run(readReflection(coding.id))).intervalMinutes, 360);
  }));

test("coding settings use revisions, validate profile references and isolate agent configuration", async () =>
  fixture(async () => {
    const owner = await run(saveAgent(agentInput()));
    const other = await run(saveAgent(agentInput()));
    const assistant = await run(saveAgent(agentInput("assistant")));
    await assert.rejects(
      run(getCodingSettings(assistant.id)),
      /not a coding agent/,
    );
    await assert.rejects(
      run(getCodingSettings(randomUUID())),
      /Agent not found/,
    );
    const empty = await run(getCodingSettings(owner.id));
    assert.equal(empty.revision, 0);
    const profile = await run(saveExecutionProfile(profileInput()));
    const settings = await run(
      saveCodingSettings({
        ...empty,
        repository: "/tmp/project",
        projectInstructions:
          "Run the targeted tests before marking work ready.",
        defaultProfileId: profile.id,
        sources: [
          {
            id: "backlog",
            name: "Project backlog",
            databaseUrl: "https://www.notion.so/database",
            filter: "Label contains Roost; status is Ready",
            instructions: "Update the ticket when a job needs review.",
          },
        ],
      }),
    );
    assert.equal(settings.revision, 1);
    assert.deepEqual(await run(getCodingSettings(owner.id)), settings);
    assert.equal((await run(getCodingSettings(other.id))).repository, "");
    await assert.rejects(
      run(saveCodingSettings({ ...empty, projectInstructions: "stale" })),
      /changed/,
    );
    await assert.rejects(
      run(saveCodingSettings({ ...settings, defaultProfileId: randomUUID() })),
      /no longer exists/,
    );
    await assert.rejects(
      run(
        saveCodingSettings({
          ...settings,
          sources: [...settings.sources, ...settings.sources],
        }),
      ),
      /unique/,
    );
    assert.deepEqual(await run(getCodingSettings(owner.id)), settings);
  }));

test("shared execution profiles protect concurrent edits and remove stale defaults without changing job snapshots", async () =>
  fixture(async () => {
    const owner = await run(saveAgent(agentInput()));
    const input = profileInput();
    const first = await run(saveExecutionProfile(input));
    await assert.rejects(run(saveExecutionProfile(input)), /changed/);
    await assert.rejects(
      run(
        saveExecutionProfile({
          ...profileInput(),
          kind: "ssh",
          target: "-oProxyCommand=sh",
        }),
      ),
      /host alias/,
    );
    const settings = await run(
      saveCodingSettings({
        ...(await run(getCodingSettings(owner.id))),
        defaultProfileId: first.id,
      }),
    );
    const job = await run(createCodingJob(jobInput(owner.id)));
    const edited = await run(
      saveExecutionProfile({ ...first, instructions: "Updated setup" }),
    );
    await assert.rejects(
      run(deleteExecutionProfile(first.id, first.revision)),
      /changed/,
    );
    assert.equal(
      (await run(getCodingJob(owner.id, job.id))).profileInstructions,
      first.instructions,
    );
    await run(deleteExecutionProfile(edited.id, edited.revision));
    assert.deepEqual(await run(listExecutionProfiles()), []);
    const after = await run(getCodingSettings(owner.id));
    assert.equal(after.defaultProfileId, null);
    assert.equal(after.revision, settings.revision + 1);
    assert.deepEqual(await run(getCodingJob(owner.id, job.id)), job);
    await assert.rejects(run(saveCodingSettings(settings)), /changed/);
  }));

test("execution profiles can describe provisioning a new host and local profiles clear SSH targets", async () =>
  fixture(async () => {
    const profile = await run(
      saveExecutionProfile({
        ...profileInput(),
        kind: "ssh",
        instructions:
          "Provision a new machine and install Herdr before launching work.",
      }),
    );
    assert.equal(profile.target, "");
    const existing = await run(
      saveExecutionProfile({ ...profile, target: " developer@devbox " }),
    );
    assert.equal(existing.target, "developer@devbox");
    const local = await run(
      saveExecutionProfile({ ...existing, kind: "local" }),
    );
    assert.equal(local.target, "");
  }));

test("jobs are durable, scoped and idempotent while launch instructions remain snapshots", async () =>
  fixture(async () => {
    const owner = await run(saveAgent(agentInput()));
    const other = await run(saveAgent(agentInput()));
    const settings = await run(
      saveCodingSettings({
        ...(await run(getCodingSettings(owner.id))),
        repository: "/repo",
        projectInstructions: "Run tests",
      }),
    );
    const input = jobInput(owner.id);
    const first = await run(createCodingJob(input));
    assert.equal(first.status, "queued");
    assert.equal(first.assignment, input.brief);
    assert.equal(first.repository, "/repo");
    assert.equal(first.projectInstructions, "Run tests");
    await run(
      saveCodingSettings({
        ...settings,
        projectInstructions: "Different instructions",
      }),
    );
    assert.deepEqual(await run(createCodingJob(input)), first);
    await assert.rejects(
      run(createCodingJob({ ...input, brief: "Different task" })),
      /already used/,
    );
    await assert.rejects(
      run(createCodingJob({ ...input, agentId: other.id })),
      /already used/,
    );
    await assert.rejects(run(getCodingJob(other.id, input.id)), /not found/);
    await assert.rejects(
      run(updateCodingJob(other.id, input.id, { status: "running" })),
      /not found/,
    );
    assert.deepEqual(await run(listCodingJobs(other.id)), []);
    const running = await run(
      updateCodingJob(
        owner.id,
        input.id,
        {
          status: "running",
          observedWorking: true,
          dispatchedAt: 10,
          output: "Running targeted checks",
        },
        first.revision,
      ),
    );
    assert.equal(running.revision, 2);
    assert.equal(running.observedWorking, true);
    assert.deepEqual(await run(createCodingJob(input)), running);
    await assert.rejects(
      run(
        updateCodingJob(
          owner.id,
          input.id,
          { status: "review" },
          first.revision,
        ),
      ),
      /changed/,
    );
    await assert.rejects(
      run(
        updateCodingJob(owner.id, input.id, {
          cwd: "/another-workspace",
        } as CodingJobPatch),
      ),
    );
    assert.deepEqual(await run(getCodingJob(owner.id, input.id)), running);
    assert.deepEqual(await run(listCodingJobs(owner.id)), [running]);
    const checked = await run(
      updateCodingJob(
        owner.id,
        input.id,
        { lastCheckedAt: Date.now() },
        running.revision,
      ),
    );
    assert.equal(checked.updatedAt, running.updatedAt);
    assert.equal(checked.revision, running.revision + 1);
  }));

test("job state can atomically settle alongside a delivery record and rolls back on failure", async () =>
  fixture(async () => {
    const owner = await run(saveAgent(agentInput()));
    const job = await run(createCodingJob(jobInput(owner.id)));
    await assert.rejects(
      run(
        withAgentStore((db) =>
          writeTransaction(db, () => {
            writeCodingJobPatch(
              db,
              owner.id,
              job.id,
              { status: "review" },
              job.revision,
            );
            throw new Error("rollback");
          }),
        ),
      ),
    );
    assert.equal((await run(getCodingJob(owner.id, job.id))).status, "queued");
    await run(
      withAgentStore((db) =>
        writeTransaction(db, () => {
          writeCodingJobPatch(
            db,
            owner.id,
            job.id,
            { status: "review", notifiedStatus: "review" },
            job.revision,
          );
          db.prepare(
            "INSERT INTO coding_job_updates(runId,jobId,agentId) VALUES(?,?,?)",
          ).run(randomUUID(), job.id, owner.id);
          assert.equal(readCodingJob(db, owner.id, job.id)?.status, "review");
          assert.equal(readCodingJob(db, randomUUID(), job.id), null);
        }),
      ),
    );
    assert.equal(
      (await run(getCodingJob(owner.id, job.id))).notifiedStatus,
      "review",
    );
  }));

test("maintenance blocks coding mutations while configuration and jobs stay readable", async () =>
  fixture(async () => {
    const owner = await run(saveAgent(agentInput()));
    const settings = await run(getCodingSettings(owner.id));
    const profile = await run(saveExecutionProfile(profileInput()));
    const job = await run(createCodingJob(jobInput(owner.id)));
    await run(
      withAgentStore((db) =>
        db.exec("UPDATE runtime_control SET maintenance=1 WHERE id=1"),
      ),
    );
    await assert.rejects(run(saveCodingSettings(settings)), /updating/);
    await assert.rejects(run(saveExecutionProfile(profile)), /updating/);
    await assert.rejects(
      run(deleteExecutionProfile(profile.id, profile.revision)),
      /updating/,
    );
    await assert.rejects(run(createCodingJob(jobInput(owner.id))), /updating/);
    await assert.rejects(
      run(updateCodingJob(owner.id, job.id, { status: "cancelled" })),
      /updating/,
    );
    assert.deepEqual(await run(getCodingSettings(owner.id)), settings);
    assert.deepEqual(await run(listCodingJobs(owner.id)), [job]);
    await run(
      withAgentStore((db) =>
        writeTransaction(db, () =>
          writeCodingJobPatch(
            db,
            owner.id,
            job.id,
            { status: "cancelled" },
            job.revision,
          ),
        ),
      ),
    );
    assert.equal(
      (await run(getCodingJob(owner.id, job.id))).status,
      "cancelled",
    );
  }));
