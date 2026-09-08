import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { withKernelLock } from "../updater/lock";

export function maintenance(root: string, enabled: boolean) {
  const path = join(root, "data/roost.sqlite");
  if (!existsSync(path)) return;
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare("UPDATE runtime_control SET maintenance=? WHERE id=1").run(
      Number(enabled),
    );
  } finally {
    db.close();
  }
}

export function activeRuns(root: string): number {
  const path = join(root, "data/roost.sqlite");
  if (!existsSync(path)) return 0;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=5000");

    const runs = Number(
      db
        .prepare(
          "SELECT count(*) AS count FROM runs WHERE status IN ('running','steering')",
        )
        .get()?.count ?? 0,
    );
    // Older installations predate coding jobs. Missing and unknown workers are
    // not evidence of quiescence; preserve them for operator inspection.
    const hasCodingJobs = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='coding_jobs'",
      )
      .get();
    const coding = hasCodingJobs
      ? Number(
          db
            .prepare(
              "SELECT count(*) AS count FROM coding_jobs WHERE status IN ('starting','running') OR (status IN ('blocked','review') AND (lastWorkerState IS NULL OR lastWorkerState != 'not_started'))",
            )
            .get()?.count ?? 0,
        )
      : 0;
    return runs + coding;
  } finally {
    db.close();
  }
}

async function withLegacyLock<T>(
  root: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "operation.lock");
  let lock: Awaited<ReturnType<typeof open>>;
  try {
    lock = await open(path, "wx", 0o600);
  } catch {
    throw new Error(
      `Another Roost operation holds ${path}. If it crashed, verify its recorded PID is no longer running before removing that lock.`,
    );
  }
  try {
    await lock.writeFile(String(process.pid));
    await lock.close();

    return await action();
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

// Keep the legacy exclusion file as well: older binaries know nothing about flock.
// Enrollment must retain a permanent sentinel before routing clients to a helper.
export async function withLock<T>(
  root: string,
  action: () => Promise<T>,
): Promise<T> {
  return withKernelLock(root, () => withLegacyLock(root, action));
}
