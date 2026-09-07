import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

    return Number(
      db
        .prepare("SELECT count(*) AS count FROM runs WHERE status='running'")
        .get()?.count ?? 0,
    );
  } finally {
    db.close();
  }
}

export async function withLock<T>(
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
