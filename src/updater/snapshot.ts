import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  statfs,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { durableJson, operationId, syncDirectory } from "./journal";

type Entry = {
  path: string;
  kind: "file" | "directory";
  size: number;
  mode: number;
  digest?: string;
};
export type Snapshot = {
  schema: 1;
  entries: Entry[];
  digest: string;
  bytes: number;
};
const maximumFiles = 250000;

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const manifestDigest = (entries: Entry[]) =>
  createHash("sha256").update(JSON.stringify(entries)).digest("hex");

/** Complete managed data only. Initial contract refuses symlinks, hard links,
 * device files, and mounts, instead of silently excluding mutable state. The
 * supervisor must first prove all writers stopped; a scan is not that proof. */
async function scan(directory: string): Promise<Snapshot> {
  const root = await realpath(directory);
  if (root !== resolve(directory))
    throw new Error("Snapshot data path must be canonical.");
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory())
    throw new Error("Snapshot data is not a directory.");
  const mounts = await readFile("/proc/self/mountinfo", "utf8");
  const decode = (path: string) =>
    path.replace(/\\([0-7]{3})/g, (_, octal: string) =>
      String.fromCharCode(Number.parseInt(octal, 8)),
    );
  for (const line of mounts.trim().split("\n")) {
    const mount = decode(line.split(" ")[4] ?? "");
    if (mount === root || mount.startsWith(`${root}/`))
      throw new Error("Mounted data requires operator-managed backup.");
  }
  const entries: Entry[] = [];
  let bytes = 0;
  async function visit(path: string) {
    const info = await lstat(path);
    if (
      info.dev !== rootStat.dev ||
      info.isSymbolicLink() ||
      (!info.isDirectory() && !info.isFile()) ||
      (info.isFile() && info.nlink !== 1)
    )
      throw new Error(
        "Unsupported link, mount, or special file in managed data.",
      );
    if (entries.length >= maximumFiles)
      throw new Error("Snapshot file count limit exceeded.");
    const entry: Entry = {
      path: relative(root, path),
      kind: info.isDirectory() ? "directory" : "file",
      size: info.isFile() ? info.size : 0,
      mode: info.mode & 0o700,
    };
    if (info.isFile()) {
      entry.digest = await hashFile(path);
      bytes += info.size;
    }
    entries.push(entry);
    if (info.isDirectory())
      for (const child of (await readdir(path)).sort())
        await visit(join(path, child));
  }
  await visit(root);
  return { schema: 1, entries, digest: manifestDigest(entries), bytes };
}

export async function requireHeadroom(
  root: string,
  bytes: number,
  files: number,
  staging = 0,
) {
  const free = await statfs(root, { bigint: true });
  if (
    ![bytes, files, staging].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  )
    throw new Error("Invalid capacity estimate.");
  if (
    free.bavail * free.bsize <
      BigInt(bytes) * 3n + BigInt(staging) + 128n * 1024n * 1024n ||
    free.ffree < BigInt(files) * 3n + 1024n
  )
    throw new Error(
      "Insufficient free space or inodes for snapshot and recovery.",
    );
}

function integrity(directory: string) {
  for (const name of ["roost.sqlite", "auth.sqlite"]) {
    const path = join(directory, name);
    // Both stores are required for the native-auth update contract.
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        db
          .prepare("PRAGMA integrity_check")
          .all()
          .some((row) => row.integrity_check !== "ok")
      )
        throw new Error("Snapshot database integrity check failed.");
    } finally {
      db.close();
    }
  }
}

export async function createSnapshot(root: string, id: string) {
  if (!operationId.test(id)) throw new Error("Invalid operation ID.");
  const source = join(root, "data");
  const before = await scan(source);
  await requireHeadroom(root, before.bytes, before.entries.length);
  const directory = join(root, "updates", id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const snapshot = join(directory, "snapshot");
  await mkdir(snapshot, { mode: 0o700 }); // Existing/partial snapshot is never reused.
  for (const child of await readdir(source)) {
    await cp(join(source, child), join(snapshot, child), {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      force: false,
      errorOnExist: true,
    });
  }
  // Copy permissions are deliberately reduced to owner-only access. Original
  // owner executable bits remain, but secrets never become group/world readable.
  for (const entry of before.entries) {
    const target = join(snapshot, entry.path);
    await chmod(target, entry.mode);
    const fd = await open(target, "r");
    try {
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  integrity(snapshot);
  const copied = await scan(snapshot);
  const after = await scan(source);
  if (copied.digest !== before.digest || after.digest !== before.digest)
    throw new Error(
      "Managed data changed during snapshot; writers are not quiescent.",
    );
  await durableJson(join(directory, "snapshot.json"), copied);
  await syncDirectory(directory);
  await syncDirectory(dirname(directory));
  return copied.digest;
}

export async function verifySnapshot(
  root: string,
  id: string,
  expected: string,
) {
  if (!operationId.test(id) || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("Invalid snapshot identity.");
  const directory = join(root, "updates", id);
  const fd = await open(join(directory, "snapshot.json"), "r");
  let value: Snapshot;
  try {
    if ((await fd.stat()).size > 64 * 1024 * 1024)
      throw new Error("Snapshot manifest too large.");
    value = JSON.parse(await fd.readFile("utf8")) as Snapshot;
  } finally {
    await fd.close();
  }
  if (
    value.schema !== 1 ||
    value.digest !== expected ||
    !Array.isArray(value.entries) ||
    manifestDigest(value.entries) !== expected
  )
    throw new Error("Snapshot manifest does not match the journal.");
  integrity(join(directory, "snapshot"));
  const actual = await scan(join(directory, "snapshot"));
  if (actual.digest !== expected)
    throw new Error("Snapshot data failed digest verification.");
  return actual;
}
