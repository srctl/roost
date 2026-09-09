import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const phases = [
  "accepted",
  "staged",
  "draining",
  "stopping",
  "snapshot-complete",
  "activating",
  "verifying",
  "committed",
  "restoring",
  "rolled-back",
  "succeeded",
  "cancelled",
  "deferred",
  "failed",
  "manual-recovery",
] as const;
export type Phase = (typeof phases)[number];
export type Journal = {
  protocol: 1;
  id: string;
  sequence: number;
  phase: Phase;
  previous: string;
  candidate: string;
  wasRunning: boolean;
  snapshotDigest?: string;
  updatedAt: number;
};
export const operationId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const version =
  /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?![\s\S])/;

export async function syncDirectory(path: string) {
  const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await fd.sync();
  } finally {
    await fd.close();
  }
}

export async function durableJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = await open(temporary, "wx", 0o600);
  try {
    await fd.writeFile(`${JSON.stringify(value)}\n`);
    await fd.sync();
  } finally {
    await fd.close();
  }
  try {
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await rm(temporary, { force: true });
  }
}

export function validateJournal(value: unknown): Journal {
  const j = value as Journal;
  if (
    j?.protocol !== 1 ||
    !operationId.test(j.id) ||
    !Number.isSafeInteger(j.sequence) ||
    j.sequence < 1 ||
    !phases.includes(j.phase) ||
    !version.test(j.previous) ||
    !version.test(j.candidate) ||
    j.previous === j.candidate ||
    typeof j.wasRunning !== "boolean" ||
    !Number.isSafeInteger(j.updatedAt) ||
    (j.snapshotDigest !== undefined && !/^[a-f0-9]{64}$/.test(j.snapshotDigest))
  )
    throw new Error("Invalid update journal; manual recovery required.");
  if (
    [
      "snapshot-complete",
      "activating",
      "verifying",
      "committed",
      "restoring",
      "rolled-back",
      "succeeded",
    ].includes(j.phase) &&
    !j.snapshotDigest
  )
    throw new Error("Update journal has no complete snapshot evidence.");
  return j;
}

export async function readJournal(root: string, id: string) {
  if (!operationId.test(id)) throw new Error("Invalid operation ID.");
  const fd = await open(
    join(root, "updates", id, "journal.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0)
      throw new Error("Unsafe update journal; manual recovery required.");
    const journal = validateJournal(JSON.parse(await fd.readFile("utf8")));
    if (journal.id !== id) throw new Error("Update journal identity mismatch.");
    return journal;
  } finally {
    await fd.close();
  }
}

export async function writeJournal(root: string, journal: Journal) {
  validateJournal(journal);
  const directory = join(root, "updates", journal.id);
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  await syncDirectory(root);
  try {
    await mkdir(directory, { mode: 0o700 });
    if (journal.sequence !== 1)
      throw new Error("Initial journal sequence must be one.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = await readJournal(root, journal.id);
    if (
      journal.sequence !== previous.sequence + 1 ||
      journal.previous !== previous.previous ||
      journal.candidate !== previous.candidate ||
      journal.wasRunning !== previous.wasRunning ||
      (previous.snapshotDigest &&
        journal.snapshotDigest !== previous.snapshotDigest) ||
      (["committed", "succeeded"].includes(previous.phase) &&
        !["committed", "succeeded", "manual-recovery"].includes(journal.phase))
    )
      throw new Error("Conflicting update journal transition.");
  }
  await syncDirectory(dirname(directory));
  await durableJson(join(directory, "journal.json"), journal);
}

/** A recovery plan is deliberately conservative and never infers commit from a
 * symlink or from an app answering health requests. Execute under kernel lock. */
export function recoveryPlan(journal: Journal) {
  validateJournal(journal);
  switch (journal.phase) {
    case "accepted":
    case "staged":
    case "draining":
      return "preserve-old";
    case "stopping":
      return "probe-old-behind-gate";
    case "snapshot-complete":
    case "activating":
    case "verifying":
    case "restoring":
      return "restore-matching-pair";
    case "committed":
      return "finish-commit-never-restore";
    case "rolled-back":
      return "finish-rollback";
    case "manual-recovery":
      return "manual-recovery";
    default:
      return "terminal";
  }
}
