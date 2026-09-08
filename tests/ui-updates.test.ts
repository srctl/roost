import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { activeRuns, withLock } from "../src/cli/state";
import { updatesRequest } from "../src/server/updates.server";
import {
  assertCompatible,
  capability,
  compareVersions,
} from "../src/updater/contract";
import {
  type Journal,
  phases,
  readJournal,
  recoveryPlan,
  writeJournal,
} from "../src/updater/journal";
import { withKernelLock } from "../src/updater/lock";
import {
  assertOffer,
  boundedBytes,
  parseOffer,
  ReleaseChecker,
} from "../src/updater/releases";
import {
  authorizeMutation,
  csrfToken,
  updateBody,
} from "../src/updater/security";
import {
  createSnapshot,
  requireHeadroom,
  verifySnapshot,
} from "../src/updater/snapshot";

const metadata = () => ({
  id: 2,
  tag_name: "v0.2.0",
  draft: false,
  prerelease: false,
  body: "<script>do not execute</script>",
  assets: [
    {
      id: 3,
      name: "roost-linux-x64.tar.gz",
      digest: `sha256:${"a".repeat(64)}`,
      size: 1234,
      url: "https://api.github.com/repos/srctl/roost/releases/assets/3",
    },
  ],
});
const contract = {
  protocol: 1,
  app: { min: 10, max: 10, output: 10 },
  auth: { min: 0, max: 0, output: 0 },
  data: "complete-snapshot-v1",
  externalState: "unchanged",
  codex: "0.153.4",
};

test("capability never infers enrollment or activates unqualified installations", () => {
  for (const facts of [
    { packaged: false, platform: "linux", arch: "x64", systemd: true },
    { packaged: true, platform: "linux", arch: "arm64", systemd: true },
    { packaged: true, platform: "linux", arch: "x64", systemd: false },
    { packaged: true, platform: "linux", arch: "x64", systemd: true },
  ])
    assert.equal(capability(facts).canActivate, false);
  assert.equal(
    capability({
      packaged: false,
      platform: "darwin",
      arch: "arm64",
      systemd: false,
    }).code,
    "externally-managed",
  );
});

test("stable numeric versions and explicit database/runtime compatibility default deny", () => {
  assert.equal(compareVersions("0.1.40", "0.1.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  for (const invalid of [
    "1.2.3-beta",
    "01.2.3",
    "9007199254740992.1.0",
    "v1.2.3",
    "1.2.3\n",
  ])
    assert.throws(() => compareVersions(invalid, "1.2.3"));
  assertCompatible(contract, { app: 10, auth: 0, codex: "0.153.4" });
  for (const installed of [
    { app: 11, auth: 0, codex: "0.153.4" },
    { app: 9, auth: 0, codex: "0.153.4" },
    { app: 10, auth: 1, codex: "0.153.4" },
    { app: 10, auth: 0, codex: "0.154.0" },
  ])
    assert.throws(() => assertCompatible(contract, installed));
  assert.throws(() =>
    assertCompatible(undefined, { app: 10, auth: 0, codex: "0.153.4" }),
  );
});

test("offers pin stable release, asset identity, digest, size and expiry", () => {
  const source = metadata();
  const offer = parseOffer(source, "srctl/roost", 1000);
  assertOffer(offer, offer.id, "0.1.40", 2000);
  assert.throws(() => assertOffer(offer, offer.id, "0.2.0", 2000));
  assert.throws(() => assertOffer(offer, offer.id, "0.1.40", offer.expiresAt));
  const changed = metadata();
  changed.assets[0]!.id = 4;
  changed.assets[0]!.url =
    "https://api.github.com/repos/srctl/roost/releases/assets/4";
  assert.notEqual(parseOffer(changed, "srctl/roost", 1000).id, offer.id);
  for (const changed of [
    { ...source, draft: true },
    { ...source, prerelease: true },
    { ...source, tag_name: "v0.2.0-rc1" },
    { ...source, assets: [...source.assets, ...source.assets] },
    { ...source, assets: [{ ...source.assets[0], digest: "" }] },
    {
      ...source,
      assets: [{ ...source.assets[0], url: "https://evil.example/archive" }],
    },
    { ...source, assets: [{ ...source.assets[0], size: 2 ** 40 }] },
  ])
    assert.throws(() => parseOffer(changed, "srctl/roost", 1000));
});

test("metadata checks coalesce, back off and never redirect credentials", async () => {
  let calls = 0;
  let now = 1000;
  const fetcher = (async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init!.headers as Record<string, string>).Authorization,
      "Bearer private-token",
    );
    return Response.json(metadata(), { headers: { etag: '"pinned"' } });
  }) as typeof fetch;
  const checker = new ReleaseChecker(
    "srctl/roost",
    fetcher,
    "private-token",
    () => now,
  );
  const [a, b] = await Promise.all([checker.check(), checker.check()]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  await assert.rejects(checker.check(), /Wait a minute/);
  now += 60001;
  await checker.check();
  assert.equal(calls, 2);
  for (const status of [401, 404, 429, 500]) {
    const failed = new ReleaseChecker(
      "srctl/roost",
      async () => new Response("private-token", { status }),
    );
    await assert.rejects(
      failed.check(),
      (error: Error) => !error.message.includes("private-token"),
    );
    assert.equal(failed.cached, undefined);
  }
});

test("streamed metadata and request bodies enforce actual byte limits and field allowlists", async () => {
  await assert.rejects(boundedBytes(new Response("12345"), 4), /size limit/);
  await assert.rejects(
    boundedBytes(
      new Response("1", { headers: { "content-length": "100" } }),
      4,
    ),
    /size limit/,
  );
  assert.equal(
    (await boundedBytes(new Response("1234"), 4)).toString(),
    "1234",
  );
  const request = (value: unknown) =>
    new Request("https://roost.example/api/updates", {
      method: "POST",
      body: JSON.stringify(value),
    });
  for (const value of [
    { unit: "other" },
    { path: "/" },
    { url: "https://evil.example" },
    [],
    null,
  ])
    await assert.rejects(updateBody(request(value), []));
  assert.deepEqual(await updateBody(request({}), []), {});
});

test("mutations require recent native authentication, exact host/origin, JSON and session-bound CSRF", () => {
  const context = {
    origin: "https://roost.example",
    session: { id: "session-a", created: 1000 },
    secret: "server-secret",
    now: 2000,
  };
  const headers = {
    origin: context.origin,
    "content-type": "application/json",
    "x-roost-csrf": csrfToken(context.secret, context.session.id),
  };
  const request = (patch = {}, url = context.origin) =>
    new Request(`${url}/api/updates`, {
      method: "POST",
      headers: { ...headers, ...patch },
      body: "{}",
    });
  authorizeMutation(request(), context);
  for (const patch of [
    { origin: "" },
    { origin: "https://evil.example" },
    { "sec-fetch-site": "cross-site" },
    { "content-type": "text/plain" },
    { "x-roost-csrf": csrfToken(context.secret, "session-b") },
    { "x-roost-csrf": "" },
  ])
    assert.throws(() => authorizeMutation(request(patch), context));
  assert.throws(() =>
    authorizeMutation(request({}, "https://evil.example"), context),
  );
  assert.throws(() =>
    authorizeMutation(request(), { ...context, session: undefined }),
  );
  assert.throws(() =>
    authorizeMutation(request(), { ...context, now: 400000 }),
  );
  assert.throws(() =>
    authorizeMutation(new Request(context.origin, { headers }), context),
  );
});

test("kernel ownership survives flock exit, excludes CLI, releases after SIGKILL, rejects symlink locks", async () => {
  const root = await mkdtemp("/tmp/ui-update-kernel-");
  try {
    await withKernelLock(root, async () => {
      await assert.rejects(
        withKernelLock(root, async () => {}),
        /operation is active/,
      );
      await assert.rejects(
        withLock(root, async () => {}),
        /operation is active/,
      );
    });
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import { withKernelLock } from './src/updater/lock.ts'; await withKernelLock(${JSON.stringify(root)},async()=>{console.log('owned');await new Promise(()=>{setInterval(()=>{},1000)});});`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await once(child.stdout!, "data");
    child.kill("SIGKILL");
    await once(child, "exit");
    await withKernelLock(root, async () => {});
    await rm(join(root, "updater.lock"));
    await writeFile(join(root, "target"), "unchanged");
    await symlink(join(root, "target"), join(root, "updater.lock"));
    await assert.rejects(withKernelLock(root, async () => {}));
    assert.equal(await readFile(join(root, "target"), "utf8"), "unchanged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("journal recovery decisions never restore after durable commit and reject corrupt evidence", async () => {
  const root = await mkdtemp("/tmp/ui-update-journal-");
  const journal: Journal = {
    protocol: 1,
    id: randomUUID(),
    sequence: 1,
    phase: "accepted",
    previous: "0.1.40",
    candidate: "0.2.0",
    wasRunning: true,
    updatedAt: 1000,
  };
  try {
    await writeJournal(root, journal);
    assert.deepEqual(await readJournal(root, journal.id), journal);
    for (const phase of phases) {
      const value = { ...journal, phase, snapshotDigest: "a".repeat(64) };
      const plan = recoveryPlan(value);
      if (phase === "committed")
        assert.equal(plan, "finish-commit-never-restore");
      if (
        ["snapshot-complete", "activating", "verifying", "restoring"].includes(
          phase,
        )
      )
        assert.equal(plan, "restore-matching-pair");
    }
    assert.throws(() => recoveryPlan({ ...journal, phase: "verifying" }));
    await writeFile(join(root, "updates", journal.id, "journal.json"), "{");
    await assert.rejects(readJournal(root, journal.id));
    await assert.rejects(readJournal(root, "../data"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complete protected snapshots include both databases and files; tampering and links fail closed", async () => {
  const root = await mkdtemp("/tmp/ui-update-snapshot-");
  try {
    await mkdir(join(root, "data"), { mode: 0o700 });
    for (const name of ["roost.sqlite", "auth.sqlite"]) {
      const db = new DatabaseSync(join(root, "data", name));
      db.exec(
        "CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES ('preserved')",
      );
      db.close();
      await chmod(join(root, "data", name), 0o600);
    }
    await writeFile(join(root, "data", "secret.txt"), "private", {
      mode: 0o600,
    });
    const id = randomUUID();
    const digest = await createSnapshot(root, id);
    const snapshot = await verifySnapshot(root, id, digest);
    assert.equal(snapshot.entries.filter((e) => e.kind === "file").length, 3);
    await writeFile(
      join(root, "updates", id, "snapshot", "secret.txt"),
      "modified",
    );
    await assert.rejects(
      verifySnapshot(root, id, digest),
      /digest verification/,
    );
    await symlink("/tmp", join(root, "data", "external"));
    await assert.rejects(
      createSnapshot(root, randomUUID()),
      /Unsupported link/,
    );
    await assert.rejects(
      requireHeadroom(root, Number.MAX_SAFE_INTEGER, 100),
      /Insufficient/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("steering, missing and null worker observations all defer service stop", async () => {
  const root = await mkdtemp("/tmp/ui-update-work-");
  await mkdir(join(root, "data"));
  const db = new DatabaseSync(join(root, "data", "roost.sqlite"));
  try {
    db.exec(
      "CREATE TABLE runs(status TEXT); INSERT INTO runs VALUES('steering'); CREATE TABLE coding_jobs(status TEXT,lastWorkerState TEXT); INSERT INTO coding_jobs VALUES('blocked','missing'),('review',NULL),('queued','unknown')",
    );
    assert.equal(activeRuns(root), 3);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("journal updates reject sequence reuse and rollback after commit", async () => {
  const root = await mkdtemp("/tmp/ui-update-journal-sequence-");
  try {
    const journal: Journal = {
      protocol: 1,
      id: randomUUID(),
      sequence: 1,
      phase: "accepted",
      previous: "0.1.40",
      candidate: "0.2.0",
      wasRunning: true,
      updatedAt: 1000,
    };
    await writeJournal(root, journal);
    await assert.rejects(writeJournal(root, journal), /Conflicting/);
    const committed: Journal = {
      ...journal,
      sequence: 2,
      phase: "committed",
      snapshotDigest: "a".repeat(64),
    };
    await writeJournal(root, committed);
    await assert.rejects(
      writeJournal(root, { ...committed, sequence: 3, phase: "restoring" }),
      /Conflicting/,
    );
    assert.equal((await readJournal(root, journal.id)).phase, "committed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source status is read-only and unauthenticated activation cannot reach any updater", async () => {
  const directory = await mkdtemp("/tmp/ui-update-http-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const response = await updatesRequest(
      new Request("https://roost.example/api/updates"),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const status = await response.json();
    assert.equal(status.capability.canActivate, false);
    assert.equal(status.version, "dev");
    assert.equal(status.canCheck, false);
    assert.equal(status.csrf, null);
    for (const path of ["/api/updates", "/api/updates/check"]) {
      const denied = await updatesRequest(
        new Request(`https://roost.example${path}`, {
          method: "POST",
          body: JSON.stringify({ unit: "arbitrary.service" }),
        }),
      );
      assert.equal(denied.status, 401);
    }
  } finally {
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    await rm(directory, { recursive: true, force: true });
  }
});
