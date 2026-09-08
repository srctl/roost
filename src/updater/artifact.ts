import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readRelease } from "../cli/releases";
import { assertCompatible, compatibility } from "./contract";
import { syncDirectory } from "./journal";
import { execute } from "./process";
import {
  boundedBytes,
  maxArchiveBytes,
  type Offer,
  parseOffer,
} from "./releases";
import { inspectData, requireHeadroom, syncTree } from "./snapshot";

export async function stageArtifact(
  root: string,
  offer: Offer,
  id: string,
  support: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  token?: string,
  fetcher: typeof fetch = fetch,
) {
  const headers = {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const release = await fetcher(
    `https://api.github.com/repos/${offer.repository}/releases/${offer.releaseId}`,
    {
      headers,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    },
  );
  if (!release.ok) throw new Error("Pinned release unavailable.");
  const current = parseOffer(
    JSON.parse((await boundedBytes(release, 2 * 1024 * 1024)).toString()),
    offer.repository,
    offer.checkedAt,
  );
  for (const key of [
    "releaseId",
    "assetId",
    "version",
    "digest",
    "size",
  ] as const)
    if (current[key] !== offer[key])
      throw new Error("Approved artifact changed.");
  const data = await inspectData(join(root, "data"));
  await requireHeadroom(
    root,
    data.bytes,
    data.entries.length,
    offer.size + 2 * 1024 ** 3,
    100000,
  );
  const directory = join(root, "updates", id);
  const archive = join(directory, "artifact.tar.gz");
  const url = `https://api.github.com/repos/${offer.repository}/releases/assets/${offer.assetId}`;
  let response = await fetcher(url, {
    headers: { ...headers, Accept: "application/octet-stream" },
    redirect: "manual",
    signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const target = new URL(response.headers.get("location") ?? "");
    await response.body?.cancel();
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      ![
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(target.hostname)
    )
      throw new Error("Untrusted artifact redirect.");
    response = await fetcher(target, {
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
    });
  }
  if (!response.ok || !response.body)
    throw new Error("Artifact download failed.");
  const fd = await open(archive, "wx", 0o600);
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > offer.size || size > maxArchiveBytes)
        throw new Error("Artifact size exceeded.");
      hash.update(chunk);
      await fd.writeFile(chunk);
      progress(size);
    }
    if (size !== offer.size || `sha256:${hash.digest("hex")}` !== offer.digest)
      throw new Error("Artifact digest/size mismatch.");
    await fd.sync();
  } finally {
    await fd.close();
  }
  signal.throwIfAborted();
  const unpacked = join(directory, "unpacked");
  await execute(
    "/usr/bin/python3",
    [join(support, "extract.py"), archive, unpacked],
    300000,
  );
  signal.throwIfAborted();
  const next = await readRelease(unpacked);
  if (next.version !== offer.version) throw new Error("Manifest/tag mismatch.");
  const c = compatibility(
    JSON.parse(await readFile(join(unpacked, "compatibility.json"), "utf8")),
  );
  const old = await readRelease(join(root, "current"));
  const versions: number[] = [];
  for (const name of ["roost.sqlite", "auth.sqlite"]) {
    const db = new DatabaseSync(join(root, "data", name), { readOnly: true });
    try {
      versions.push(
        Number(db.prepare("PRAGMA user_version").get()?.user_version),
      );
    } finally {
      db.close();
    }
  }
  assertCompatible(c, {
    app: versions[0]!,
    auth: versions[1]!,
    codex: old.codex,
  });
  if (c.codex !== next.codex)
    throw new Error("Bundled runtime does not match compatibility contract.");
  // Rollback must also support the verification gate, not just the candidate.
  const previousContract = JSON.parse(
    await readFile(join(root, "current", "compatibility.json"), "utf8"),
  );
  compatibility(previousContract);
  if (
    previousContract.startupGate !== 1 ||
    JSON.parse(await readFile(join(unpacked, "compatibility.json"), "utf8"))
      .startupGate !== 1
  )
    throw new Error("Both releases require the startup verification gate.");
  for (const file of ["runtime/node", "runtime/codex/bin/codex"]) {
    if (!((await lstat(join(unpacked, file))).mode & 0o100))
      throw new Error("Runtime is not executable.");
    const output = await execute(join(unpacked, file), ["--version"], 15000);
    if (!output.includes(file === "runtime/node" ? next.node : next.codex))
      throw new Error("Bundled runtime cannot execute.");
  }
  await mkdir(join(root, "releases"), { recursive: true, mode: 0o700 });
  // A retry may reuse byte-identical verified staging; never replace a retained
  // release merely because its version name matches a new publisher artifact.
  try {
    await lstat(join(root, "releases", offer.version));
    if (
      (await inspectData(unpacked)).digest !==
      (await inspectData(join(root, "releases", offer.version))).digest
    )
      throw new Error("Existing candidate differs from the approved artifact.");
    await rm(unpacked, { recursive: true, force: true });
    await rm(archive, { force: true });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await syncTree(unpacked);
  await rename(unpacked, join(root, "releases", offer.version));
  await syncDirectory(join(root, "releases"));
  await rm(archive, { force: true });
}
