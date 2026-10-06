import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readRelease } from "./releases";
import { activeRuns, readJson } from "./state";

const versionPattern = /^\d+\.\d+\.\d+$/;
const backupPattern = /^(\d+\.\d+\.\d+)-(\d+)$/;
export const storagePolicy = {
  version: 1,
  backups: 1,
  releases: 2,
  logDays: 7,
  logBytesPerAgent: 256 * 1024 * 1024,
} as const;
type Receipt = {
  version: 1;
  name: string;
  sourceVersion: string;
  updatedVersion: string;
  verifiedAt: string;
  digest: string;
};

// Retention never follows links in managed directories, including their parents.
async function safePath(root: string, parts: string[]) {
  let path = await realpath(root);
  for (const part of parts) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      part.includes("/") ||
      part.includes("\\")
    )
      throw new Error("Unsafe storage path.");
    path = join(path, part);
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`Storage path is a symlink: ${path}`);
  }
  return path;
}
async function directories(root: string, name: string) {
  if (!existsSync(join(root, name))) return [];
  const path = await safePath(root, [name]);
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
function compareVersion(a: string, b: string) {
  const left = a.split(".").map(Number),
    right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}
async function snapshotDigest(root: string, name: string, check: boolean) {
  const directory = await safePath(root, ["backups", name]);
  const path = await safePath(root, ["backups", name, "roost.sqlite"]);
  if (!(await lstat(path)).isFile())
    throw new Error("Backup database is not a regular file.");
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(path + suffix))
      await safePath(root, ["backups", name, `roost.sqlite${suffix}`]);
  }
  if (check) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok")
        throw new Error("Backup database failed integrity check.");
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Backup database has foreign key violations.");
    } finally {
      db.close();
    }
  }
  const hash = createHash("sha256");
  for (const file of ["roost.sqlite", "roost.sqlite-wal"]) {
    hash.update(file);
    if (!existsSync(join(directory, file))) {
      hash.update("absent");
      continue;
    }
    const input = await safePath(root, ["backups", name, file]);
    if (!(await lstat(input)).isFile())
      throw new Error("Invalid backup database file.");
    for await (const chunk of createReadStream(input)) hash.update(chunk);
  }
  return hash.digest("hex");
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function enableStorage(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await atomicJson(join(root, "storage-policy.json"), storagePolicy);
}
async function policy(root: string) {
  const path = join(root, "storage-policy.json");
  if (!existsSync(path)) return false;
  const value = await readJson<typeof storagePolicy>(
    await safePath(root, ["storage-policy.json"]),
  );
  for (const key of Object.keys(
    storagePolicy,
  ) as (keyof typeof storagePolicy)[]) {
    if (value[key] !== storagePolicy[key])
      throw new Error(
        "Unsupported storage policy. Run roost storage enable to install the supported defaults.",
      );
  }
  return true;
}
// Register only after a complete updater copy and a healthy successor. Legacy
// snapshots require the operator to confirm that completed-copy provenance.
export async function registerBackup(
  root: string,
  name: string,
  updatedVersion: string,
) {
  const match = backupPattern.exec(name);
  if (
    !match ||
    !versionPattern.test(updatedVersion) ||
    compareVersion(match[1]!, updatedVersion) >= 0
  )
    throw new Error("Invalid backup or successor version.");
  const source = await readRelease(
    await safePath(root, ["releases", match[1]!]),
  );
  const current = await readRelease(join(root, "current"));
  if (source.version !== match[1] || current.version !== updatedVersion)
    throw new Error("Backup source or current release does not match.");
  const digest = await snapshotDigest(root, name, true);
  const directory = join(root, "backups/.verified");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await safePath(root, ["backups", ".verified"]);
  const receipt: Receipt = {
    version: 1,
    name,
    sourceVersion: source.version,
    updatedVersion,
    verifiedAt: new Date().toISOString(),
    digest,
  };
  await atomicJson(join(directory, `${name}.json`), receipt);
}
export function storageBusy(root: string) {
  if (activeRuns(root)) return true;
  const path = join(root, "data/roost.sqlite");
  if (!existsSync(path)) return true;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return !!db
      .prepare("SELECT maintenance FROM runtime_control WHERE id=1")
      .get()?.maintenance;
  } finally {
    db.close();
  }
}
export async function storagePlan(root: string) {
  const enabled = await policy(root);
  const currentPath = await realpath(join(root, "current"));
  const current = await readRelease(currentPath);
  if (currentPath !== (await safePath(root, ["releases", current.version])))
    throw new Error(
      "Current release is outside the managed release directory.",
    );
  const backups = (await directories(root, "backups"))
    .filter((name) => backupPattern.test(name))
    .sort(
      (a, b) =>
        Number(backupPattern.exec(b)![2]) - Number(backupPattern.exec(a)![2]),
    );
  let verified: Receipt | undefined;
  // If the newest snapshot is incomplete or unverified, leave every backup.
  if (backups[0]) {
    const name = backups[0];
    const receiptPath = join(root, "backups/.verified", `${name}.json`);
    if (existsSync(receiptPath)) {
      const receipt = await readJson<Receipt>(
        await safePath(root, ["backups", ".verified", `${name}.json`]),
      );
      if (
        receipt.version === 1 &&
        receipt.name === name &&
        receipt.sourceVersion === backupPattern.exec(name)![1] &&
        versionPattern.test(receipt.updatedVersion) &&
        compareVersion(receipt.sourceVersion, receipt.updatedVersion) < 0 &&
        compareVersion(receipt.updatedVersion, current.version) <= 0 &&
        receipt.digest === (await snapshotDigest(root, name, false))
      )
        verified = receipt;
    }
  }
  const releases: string[] = [];
  for (const name of await directories(root, "releases")) {
    if (!versionPattern.test(name)) continue;
    try {
      if (
        (await readRelease(await safePath(root, ["releases", name])))
          .version === name
      )
        releases.push(name);
    } catch {
      /* Unknown or incomplete release directories are preserved. */
    }
  }
  if (verified && !releases.includes(verified.sourceVersion))
    throw new Error(
      "Verified backup source release is unavailable; retention deferred.",
    );
  const keepReleases = new Set([current.version]);
  const previous = releases
    .filter((name) => compareVersion(name, current.version) < 0)
    .sort(compareVersion)
    .at(-1);
  if (previous) keepReleases.add(previous);
  // Preserve the release needed to restore every snapshot that will survive.
  const keptBackups = verified ? backups.slice(0, 1) : backups;
  for (const name of keptBackups)
    keepReleases.add(backupPattern.exec(name)![1]!);
  const removeBackups: string[] = [];
  if (verified)
    for (const name of backups.slice(1)) {
      if (compareVersion(backupPattern.exec(name)![1]!, current.version) >= 0)
        continue;
      try {
        await safePath(root, ["backups", name, "roost.sqlite"]);
        removeBackups.push(name);
      } catch {
        /* Partial snapshots remain available for diagnosis. */
      }
    }
  const db = new DatabaseSync(join(root, "data/roost.sqlite"), {
    readOnly: true,
  });
  let references = "";
  try {
    if (
      db.prepare("SELECT 1 FROM sqlite_master WHERE name='coding_jobs'").get()
    )
      references = JSON.stringify(
        db.prepare("SELECT cwd FROM coding_jobs").all(),
      );
  } finally {
    db.close();
  }
  const removableBackups = removeBackups.filter(
    (name) => !references.includes(join(root, "backups", name)),
  );
  for (const name of backups.filter((name) => !removableBackups.includes(name)))
    keepReleases.add(backupPattern.exec(name)![1]!);
  for (const name of releases)
    if (references.includes(join(root, "releases", name)))
      keepReleases.add(name);
  return {
    enabled,
    busy: storageBusy(root),
    verifiedBackup: verified?.name ?? null,
    keepBackups: backups.filter((name) => !removableBackups.includes(name)),
    keepReleases: [...keepReleases],
    removeBackups: removableBackups,
    removeReleases: releases.filter(
      (name) =>
        !keepReleases.has(name) &&
        compareVersion(name, current.version) < 0 &&
        !references.includes(join(root, "releases", name)),
    ),
    logDays: storagePolicy.logDays,
    logBytesPerAgent: storagePolicy.logBytesPerAgent,
  };
}
export function pruneLog(
  path: string,
  now = Date.now(),
  budgetMs = 1000,
  maxBytes: number = storagePolicy.logBytesPerAgent,
) {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=250");
    const columns = db
      .prepare("PRAGMA table_info(logs)")
      .all()
      .map((row) => row.name);
    if (
      ![
        "id",
        "ts",
        "ts_nanos",
        "estimated_bytes",
        "level",
        "target",
        "feedback_log_body",
      ].every((name) => columns.includes(name))
    )
      return { skipped: "unsupported log schema" };
    db.exec("BEGIN IMMEDIATE");
    let deleted = 0;
    try {
      deleted += Number(
        db
          .prepare("DELETE FROM logs WHERE ts < ?")
          .run(Math.floor(now / 1000) - storagePolicy.logDays * 86400).changes,
      );
      deleted += Number(
        db
          .prepare(
            "WITH ranked AS (SELECT id, SUM(MAX(0, COALESCE(estimated_bytes,0))) OVER (ORDER BY ts DESC, ts_nanos DESC, id DESC ROWS UNBOUNDED PRECEDING) AS bytes FROM logs) DELETE FROM logs WHERE id IN (SELECT id FROM ranked WHERE bytes > ?)",
          )
          .run(maxBytes).changes,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
    // Incremental vacuum returns free pages without copying a multi-GB database.
    // Bound compaction time; remaining free pages are reclaimed next iteration.
    const deadline = Date.now() + budgetMs;
    if (db.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum === 2) {
      while (
        Date.now() < deadline &&
        Number(db.prepare("PRAGMA freelist_count").get()?.freelist_count) > 0
      )
        db.exec("PRAGMA incremental_vacuum(256)");
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return {
      deleted,
      retainedBytes: Number(
        db
          .prepare(
            "SELECT COALESCE(SUM(MAX(0,COALESCE(estimated_bytes,0))),0) AS bytes FROM logs",
          )
          .get()?.bytes,
      ),
      freePages: Number(
        db.prepare("PRAGMA freelist_count").get()?.freelist_count,
      ),
    };
  } finally {
    db.close();
  }
}
export async function applyStorage(root: string) {
  const plan = await storagePlan(root);
  if (!plan.enabled || plan.busy) return { ...plan, applied: false, logs: [] };
  // The plan checks the rollback digest before deleting; operation.lock keeps
  // updates and other retention processes out of these managed directories.
  for (const name of plan.removeBackups) {
    if (storageBusy(root)) return { ...plan, applied: false, logs: [] };
    await rm(await safePath(root, ["backups", name]), { recursive: true });
    await safePath(root, ["backups", ".verified"]);
    await rm(join(root, "backups/.verified", `${name}.json`), { force: true });
  }
  for (const name of plan.removeReleases) {
    if (storageBusy(root)) return { ...plan, applied: false, logs: [] };
    await rm(await safePath(root, ["releases", name]), { recursive: true });
  }
  const logs: unknown[] = [];
  if (existsSync(join(root, "data/agents"))) {
    const agents = await safePath(root, ["data", "agents"]);
    for (const entry of await readdir(agents, { withFileTypes: true })) {
      if (!entry.isDirectory() || storageBusy(root)) continue;
      const parts = ["data", "agents", entry.name, "codex"];
      if (!existsSync(join(root, ...parts))) continue;
      try {
        const directory = await safePath(root, parts);
        let remainingBytes: number = storagePolicy.logBytesPerAgent;
        const files = (await readdir(directory, { withFileTypes: true })).sort(
          (a, b) =>
            Number(b.name.match(/^logs_(\d+)\.sqlite$/)?.[1] ?? 0) -
            Number(a.name.match(/^logs_(\d+)\.sqlite$/)?.[1] ?? 0),
        );
        for (const file of files) {
          if (
            !file.isFile() ||
            !/^logs_\d+\.sqlite$/.test(file.name) ||
            storageBusy(root)
          )
            continue;
          const path = await safePath(root, [...parts, file.name]);
          // Do not open SQLite sidecars through an unexpected symlink either.
          for (const suffix of ["-wal", "-shm"])
            if (existsSync(path + suffix))
              await safePath(root, [...parts, file.name + suffix]);
          const result = pruneLog(path, Date.now(), 10000, remainingBytes);
          remainingBytes = Math.max(
            0,
            remainingBytes - (result.retainedBytes ?? 0),
          );
          logs.push({ agent: entry.name, file: file.name, ...result });
        }
      } catch (error) {
        logs.push({
          agent: entry.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { ...plan, applied: true, logs };
}
export async function storageCommand(root: string, args: string[]) {
  const [action, ...rest] = args;
  if (action === "enable" && !rest.length) {
    await enableStorage(root);
    return storagePlan(root);
  }
  if (action === "plan" && !rest.length) return storagePlan(root);
  if (action === "apply" && !rest.length) {
    const result = await applyStorage(root);
    if (result.enabled)
      await atomicJson(join(root, "storage-last-run.json"), {
        at: new Date().toISOString(),
        ...result,
      });
    return result;
  }
  if (action === "register-backup" && rest.length === 2) {
    if (storageBusy(root))
      throw new Error(
        "Wait for idle work and maintenance to finish before registering a backup.",
      );
    await registerBackup(root, rest[0]!, rest[1]!);
    return { registered: rest[0] };
  }
  throw new Error(
    "Use roost storage enable, plan, apply, or register-backup <completed-snapshot> <healthy-successor-version>.",
  );
}
