import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { withAgentStore, saveAgent } from "../src/server/agents/store.server";
import {
  enqueueChat,
  claimRun,
  schedulerTick,
  finishRun,
} from "../src/server/runs/store.server";
import { saveAutomation } from "../src/server/automations/store.server";
import { maintenance, withLock } from "../src/cli/state";
import {
  activate,
  installRelease,
  verifyDigest,
  validateArchive,
} from "../src/cli/releases";
import { applyUpdate } from "../src/cli/update";
const run = Effect.runPromise;
async function release(root: string, version: string) {
  const directory = join(root, "releases", version);
  for (const file of [
    "runtime/node",
    "runtime/codex/bin/codex",
    "cli/roost.mjs",
    "app/server/index.mjs",
    "bin/roost",
  ]) {
    await mkdir(join(directory, file, ".."), { recursive: true });
    await writeFile(join(directory, file), "fixture");
  }
  await writeFile(
    join(directory, "release.json"),
    JSON.stringify({
      version,
      platform: "linux",
      arch: "x64",
      node: "24.15.0",
      codex: "0.153.4",
      schema: 1,
    }),
  );
  return directory;
}

test("release validation rejects modified archives and unsafe paths before replacing the current release", async () => {
  const root = await mkdtemp("/tmp/roost-release-");
  try {
    const bytes = Buffer.from("release");
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    verifyDigest(bytes, hash);
    assert.throws(
      () => verifyDigest(Buffer.from("modified"), hash),
      /checksum/,
    );
    assert.throws(
      () => validateArchive(["./app/server/index.mjs", "../outside"]),
      /unsafe/,
    );
    assert.throws(() => validateArchive(["/outside"]), /unsafe/);
    const old = await release(root, "0.1.0");
    await activate(root, old);
    const incomplete = join(root, "incomplete");
    await mkdir(incomplete);
    await assert.rejects(installRelease(root, incomplete));
    assert.equal(await realpath(join(root, "current")), await realpath(old));
    await withLock(root, async () =>
      assert.rejects(
        withLock(root, async () => undefined),
        /Another Roost/,
      ),
    );
    await withLock(root, async () => undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema migration preserves legacy agents and refuses newer databases", async () => {
  const directory = await mkdtemp("/tmp/roost-migration-");
  try {
    const db = new DatabaseSync(join(directory, "roost.sqlite"));
    db.exec(
      "CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT NOT NULL, character TEXT NOT NULL, model TEXT NOT NULL, createdAt TEXT NOT NULL); INSERT INTO agents VALUES ('saved','Scout','Help','moss','astra','today');",
    );
    db.close();
    await run(
      withAgentStore((db) => {
        assert.equal(
          db.prepare("SELECT name FROM agents WHERE id='saved'").get()?.name,
          "Scout",
        );
        assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 1);
        assert.equal(
          db.prepare("SELECT maintenance FROM runtime_control").get()
            ?.maintenance,
          0,
        );
        db.exec("PRAGMA user_version=2");
      }, directory),
    );
    await assert.rejects(
      run(withAgentStore(() => undefined, directory)),
      /newer version/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("maintenance drains active work, preserves queued work, and pauses new scheduled runs", async () => {
  const root = await mkdtemp("/tmp/roost-maintenance-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = join(root, "data");
  try {
    const a = await run(
      saveAgent({
        id: randomUUID(),
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const send = () =>
      run(
        enqueueChat({ agentId: a.id, messageId: randomUUID(), text: "hello" }),
      );
    await send();
    await send();
    await run(schedulerTick("worker"));
    const active = await run(claimRun("worker"));
    await run(
      saveAutomation({
        agentId: a.id,
        id: randomUUID(),
        name: "Check",
        prompt: "check",
        schedule: { kind: "interval", minutes: 60 },
        notification: "always",
      }),
    );
    await run(
      withAgentStore((db) => db.exec("UPDATE automations SET nextRunAt=0")),
    );
    maintenance(root, true);
    await assert.rejects(send(), /updating/);
    assert.equal(await run(claimRun("worker")), undefined);
    await run(schedulerTick("worker"));
    await run(
      finishRun(active!, "completed", [
        { id: "answer", role: "assistant", text: "done" },
      ]),
    );
    await run(
      withAgentStore((db) => {
        assert.equal(
          db
            .prepare("SELECT count(*) AS n FROM runs WHERE kind='automation'")
            .get()?.n,
          0,
        );
        assert.equal(
          db.prepare("SELECT status FROM runs WHERE id=?").get(active!.id)
            ?.status,
          "completed",
        );
      }),
    );
    maintenance(root, false);
    assert.ok(await run(claimRun("worker")));
    await run(schedulerTick("worker"));
    await run(
      withAgentStore((db) =>
        assert.equal(
          db
            .prepare("SELECT count(*) AS n FROM runs WHERE kind='automation'")
            .get()?.n,
          1,
        ),
      ),
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("failed update health restores release, database, soul files, and prior service state", async () => {
  for (const initiallyRunning of [true, false]) {
    const root = await mkdtemp("/tmp/roost-rollback-");
    try {
      await run(withAgentStore(() => undefined, join(root, "data")));
      await writeFile(join(root, "data/SOUL.md"), "original soul");
      const old = await release(root, "0.1.0"),
        next = await release(root, "0.2.0");
      await activate(root, old);
      let active = initiallyRunning;
      await assert.rejects(
        applyUpdate(
          root,
          old,
          next,
          {
            isActive: async () => active,
            start: async () => {
              active = true;
            },
            stop: async () => {
              active = false;
            },
            healthy: async (version) => {
              if (version === "0.2.0") {
                await writeFile(
                  join(root, "data/SOUL.md"),
                  "changed during migration",
                );
                const db = new DatabaseSync(join(root, "data/roost.sqlite"));
                db.exec("PRAGMA user_version=2");
                db.close();
                throw new Error("bad health");
              }
            },
          },
          new AbortController().signal,
        ),
        /bad health/,
      );
      assert.equal(active, initiallyRunning);
      assert.equal(await realpath(join(root, "current")), await realpath(old));
      assert.equal(
        await readFile(join(root, "data/SOUL.md"), "utf8"),
        "original soul",
      );
      await run(
        withAgentStore(
          (db) =>
            assert.equal(
              db.prepare("SELECT maintenance FROM runtime_control").get()
                ?.maintenance,
              0,
            ),
          join(root, "data"),
        ),
      );
      // The failed candidate can be retried with a new download.
      const retry = await release(root, "0.2.0");
      await applyUpdate(
        root,
        old,
        retry,
        {
          isActive: async () => active,
          start: async () => {
            active = true;
          },
          stop: async () => {
            active = false;
          },
          healthy: async () => undefined,
        },
        new AbortController().signal,
      );
      assert.equal(
        await realpath(join(root, "current")),
        await realpath(retry),
      );
      assert.equal(active, initiallyRunning);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
