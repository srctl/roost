import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { activate } from "../src/cli/releases";
import { withLock } from "../src/cli/state";
import {
  applyStorage,
  enableStorage,
  pruneLog,
  registerBackup,
  storagePlan,
  storagePolicy,
} from "../src/cli/storage";
import { applyUpdate } from "../src/cli/update";

async function release(root: string, version: string) {
  const path = join(root, "releases", version);
  for (const file of [
    "runtime/node",
    "runtime/codex/bin/codex",
    "cli/roost.mjs",
    "app/server/index.mjs",
    "bin/roost",
  ]) {
    await mkdir(join(path, file, ".."), { recursive: true });
    await writeFile(join(path, file), "");
  }
  await writeFile(
    join(path, "release.json"),
    JSON.stringify({
      version,
      platform: "linux",
      arch: "x64",
      node: "24.15.0",
      codex: "0.160.0",
      schema: 1,
    }),
  );
  return path;
}
async function fixture() {
  const root = await mkdtemp("/tmp/roost-retention-");
  await mkdir(join(root, "data"));
  const db = new DatabaseSync(join(root, "data/roost.sqlite"));
  db.exec(
    "CREATE TABLE runs(status TEXT); CREATE TABLE runtime_control(id INTEGER,maintenance INTEGER); INSERT INTO runtime_control VALUES (1,0); CREATE TABLE coding_jobs(status TEXT,lastWorkerState TEXT,cwd TEXT)",
  );
  db.close();
  for (const version of ["0.1.0", "0.2.0", "0.3.0"])
    await release(root, version);
  await activate(root, join(root, "releases/0.3.0"));
  for (const name of ["0.1.0-1000", "0.2.0-2000"]) {
    await mkdir(join(root, "backups", name), { recursive: true });
    const backup = new DatabaseSync(
      join(root, "backups", name, "roost.sqlite"),
    );
    backup.exec(
      "CREATE TABLE preserved(value TEXT); INSERT INTO preserved VALUES ('history')",
    );
    backup.close();
  }
  await registerBackup(root, "0.2.0-2000", "0.3.0");
  await enableStorage(root);
  return root;
}

test("retention removes only older backups and releases and leaves manual rollback files and history", async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, "backups/model-rollback.json"),
      "private rollback",
    );
    await mkdir(join(root, "failed-update-123"));
    await writeFile(join(root, "data/history"), "conversation");
    await release(root, "0.4.0");
    const before = await storagePlan(root);
    assert.deepEqual(before.removeBackups, ["0.1.0-1000"]);
    assert.deepEqual(before.removeReleases, ["0.1.0"]);
    const result = await withLock(root, () => applyStorage(root));
    assert.equal(result.applied, true);
    await assert.rejects(access(join(root, "backups/0.1.0-1000")));
    await assert.rejects(access(join(root, "releases/0.1.0")));
    for (const path of [
      "backups/0.2.0-2000/roost.sqlite",
      "releases/0.2.0",
      "releases/0.3.0",
      "releases/0.4.0",
      "failed-update-123",
    ])
      await access(join(root, path));
    assert.equal(
      await readFile(join(root, "backups/model-rollback.json"), "utf8"),
      "private rollback",
    );
    assert.equal(
      await readFile(join(root, "data/history"), "utf8"),
      "conversation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("newer unverified or modified verified backup prevents pruning rollback data and its releases", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, "backups/0.3.0-3000"));
    const incomplete = await storagePlan(root);
    assert.equal(incomplete.verifiedBackup, null);
    assert.deepEqual(incomplete.removeBackups, []);
    assert.deepEqual(incomplete.removeReleases, []);
    await rm(join(root, "backups/0.3.0-3000"), { recursive: true });
    const db = new DatabaseSync(join(root, "backups/0.2.0-2000/roost.sqlite"));
    db.exec("INSERT INTO preserved VALUES ('unexpected change')");
    db.close();
    const changed = await storagePlan(root);
    assert.equal(changed.verifiedBackup, null);
    assert.deepEqual(changed.removeBackups, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlinked managed directories fail closed, linked log databases are never touched", async () => {
  const root = await fixture();
  const outside = await mkdtemp("/tmp/roost-retention-outside-");
  try {
    await writeFile(join(outside, "logs_2.sqlite"), "outside");
    await mkdir(join(root, "data/agents/agent/codex"), { recursive: true });
    await symlink(
      join(outside, "logs_2.sqlite"),
      join(root, "data/agents/agent/codex/logs_2.sqlite"),
    );
    await withLock(root, () => applyStorage(root));
    assert.equal(
      await readFile(join(outside, "logs_2.sqlite"), "utf8"),
      "outside",
    );
    await rm(join(root, "backups"), { recursive: true });
    await symlink(outside, join(root, "backups"));
    await assert.rejects(storagePlan(root), /symlink/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("retention waits for active runs, resumable coding jobs and maintenance", async () => {
  const root = await fixture();
  const db = new DatabaseSync(join(root, "data/roost.sqlite"));
  try {
    for (const change of [
      "INSERT INTO runs VALUES ('running')",
      "DELETE FROM runs; INSERT INTO coding_jobs VALUES ('blocked','idle','/work')",
      "DELETE FROM coding_jobs; UPDATE runtime_control SET maintenance=1",
    ]) {
      db.exec(change);
      assert.equal(
        (await withLock(root, () => applyStorage(root))).applied,
        false,
      );
      await access(join(root, "backups/0.1.0-1000"));
    }
    db.exec(
      "UPDATE runtime_control SET maintenance=0; INSERT INTO coding_jobs VALUES ('blocked','missing','/work')",
    );
    assert.equal(
      (await withLock(root, () => applyStorage(root))).applied,
      true,
    );
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("log pruning keeps newest content within age and byte budgets without touching thread history", async () => {
  const root = await fixture();
  const path = join(root, "data/agents/agent/codex");
  await mkdir(path, { recursive: true });
  const db = new DatabaseSync(join(path, "logs_2.sqlite"));
  const now = Math.floor(Date.now() / 1000);
  db.exec(
    "PRAGMA auto_vacuum=INCREMENTAL; CREATE TABLE logs(id INTEGER PRIMARY KEY,ts INTEGER,ts_nanos INTEGER,estimated_bytes INTEGER,level TEXT,target TEXT,feedback_log_body TEXT)",
  );
  const insert = db.prepare(
    "INSERT INTO logs VALUES (?, ?, 0, ?, 'INFO', 'test', 'diagnostic')",
  );
  insert.run(1, now - 8 * 86400, 1);
  insert.run(2, now - 2, storagePolicy.logBytesPerAgent);
  insert.run(3, now - 1, 20);
  insert.run(4, now, 30);
  db.close();
  await writeFile(join(path, "thread_history_1.sqlite"), "protected");
  try {
    const result = await withLock(root, () => applyStorage(root));
    assert.equal(result.applied, true);
    const read = new DatabaseSync(join(path, "logs_2.sqlite"), {
      readOnly: true,
    });
    assert.deepEqual(
      read
        .prepare("SELECT id FROM logs ORDER BY id")
        .all()
        .map((row) => row.id),
      [3, 4],
    );
    read.close();
    assert.equal(
      await readFile(join(path, "thread_history_1.sqlite"), "utf8"),
      "protected",
    );
    const unknown = new DatabaseSync(join(path, "logs_9.sqlite"));
    unknown.exec("CREATE TABLE logs(id INTEGER)");
    unknown.close();
    assert.deepEqual(pruneLog(join(path, "logs_9.sqlite")), {
      skipped: "unsupported log schema",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retention errors after a healthy update do not roll back the new release", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "storage-policy.json"), "{}");
    const next = await release(root, "0.4.0");
    let stops = 0;
    await withLock(root, () =>
      applyUpdate(
        root,
        join(root, "releases/0.3.0"),
        next,
        {
          isActive: async () => true,
          start: async () => {},
          stop: async () => {
            stops++;
          },
          healthy: async () => {},
        },
        new AbortController().signal,
      ),
    );
    assert.equal(stops, 1);
    assert.equal(
      (await realpath(join(root, "current"))).split("/").at(-1),
      "0.4.0",
    );
    const db = new DatabaseSync(join(root, "data/roost.sqlite"));
    assert.equal(
      db.prepare("SELECT maintenance FROM runtime_control").get()?.maintenance,
      0,
    );
    db.close();
    assert.ok(
      (
        await readFile(join(root, "releases/0.4.0/release.json"), "utf8")
      ).includes("0.4.0"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an agent's content cap is shared across log database versions", async () => {
  const root = await fixture();
  try {
    const path = join(root, "data/agents/agent/codex");
    await mkdir(path, { recursive: true });
    for (const name of ["logs_1.sqlite", "logs_2.sqlite"]) {
      const db = new DatabaseSync(join(path, name));
      db.exec(
        "CREATE TABLE logs(id INTEGER PRIMARY KEY,ts INTEGER,ts_nanos INTEGER,estimated_bytes INTEGER,level TEXT,target TEXT,feedback_log_body TEXT)",
      );
      db.prepare(
        "INSERT INTO logs VALUES (1,?,0,?,'INFO','test','diagnostic')",
      ).run(Math.floor(Date.now() / 1000), storagePolicy.logBytesPerAgent);
      db.close();
    }
    const result = await withLock(root, () => applyStorage(root));
    assert.equal(
      result.logs.reduce(
        (sum: number, row: unknown) =>
          sum + Number((row as { retainedBytes?: number }).retainedBytes ?? 0),
        0,
      ),
      storagePolicy.logBytesPerAgent,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saved coding paths preserve a backup and the release needed to restore it", async () => {
  const root = await fixture();
  try {
    const db = new DatabaseSync(join(root, "data/roost.sqlite"));
    db.prepare("INSERT INTO coding_jobs VALUES ('completed','missing',?)").run(
      join(root, "backups/0.1.0-1000/workspaces/job"),
    );
    db.close();
    const plan = await storagePlan(root);
    assert.deepEqual(plan.removeBackups, []);
    assert.deepEqual(plan.removeReleases, []);
    assert.ok(plan.keepBackups.includes("0.1.0-1000"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
