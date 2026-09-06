import { createHash, randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  cp,
  rename,
  symlink,
  rm,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { command } from "./service";

export type Release = {
  version: string;
  platform: "linux";
  arch: "x64";
  node: string;
  codex: string;
  schema: number;
  repository?: string;
};
export function validateRelease(value: unknown): Release {
  const r = value as Release;
  if (
    !r ||
    !/^\d+\.\d+\.\d+$/.test(r.version) ||
    r.platform !== "linux" ||
    r.arch !== "x64" ||
    !/^\d+\.\d+\.\d+$/.test(r.node) ||
    !/^\d+\.\d+\.\d+$/.test(r.codex) ||
    r.schema !== 1
  )
    throw new Error("Unsupported or invalid Roost release manifest.");
  return r;
}
export async function readRelease(directory: string) {
  const release = validateRelease(
    JSON.parse(await readFile(join(directory, "release.json"), "utf8")),
  );
  for (const file of [
    "runtime/node",
    "runtime/codex/bin/codex",
    "cli/roost.mjs",
    "app/server/index.mjs",
    "bin/roost",
  ]) {
    if (!(await lstat(join(directory, file))).isFile())
      throw new Error(`Release is missing ${file}.`);
  }
  return release;
}
export async function activate(root: string, target: string) {
  const temporary = join(root, `.current-${randomUUID()}`);
  await symlink(target, temporary);
  try {
    await rename(temporary, join(root, "current"));
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function installRelease(root: string, source: string) {
  const release = await readRelease(source);
  const destination = join(root, "releases", release.version);
  await mkdir(join(root, "releases"), { recursive: true, mode: 0o700 });
  const temporary = `${destination}-${randomUUID()}`;
  try {
    await cp(source, temporary, { recursive: true, dereference: false });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { release, destination };
}
export function verifyDigest(bytes: Uint8Array, expected: string) {
  if (
    !/^sha256:[a-f0-9]{64}$/.test(expected) ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== expected
  )
    throw new Error("Release checksum verification failed.");
}
export function validateArchive(entries: string[]) {
  if (
    entries.some(
      (path) => path.startsWith("/") || path.split("/").includes(".."),
    )
  )
    throw new Error("Release archive contains unsafe paths.");
}
export async function downloadRelease(
  repository: string,
  directory: string,
  version?: string,
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error(
      "Set a GitHub repository as owner/repository using roost setup --repository.",
    );
  if (version && !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Use a version such as 0.1.0.");
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/${version ? `tags/v${version}` : "latest"}`,
    { headers, signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok)
    throw new Error(
      `GitHub release lookup failed (${response.status}). Check the repository and release; private repositories need GH_TOKEN.`,
    );
  const release = (await response.json()) as {
    tag_name: string;
    assets: { name: string; url: string; digest?: string }[];
  };
  const asset = release.assets.find(
    (asset) => asset.name === "roost-linux-x64.tar.gz",
  );
  if (
    !asset?.digest ||
    !asset.url.startsWith(
      `https://api.github.com/repos/${repository}/releases/assets/`,
    )
  )
    throw new Error("Release has no Linux x64 asset with a checksum.");
  const download = await fetch(asset.url, {
    headers: { ...headers, Accept: "application/octet-stream" },
    signal: AbortSignal.timeout(300000),
  });
  if (!download.ok)
    throw new Error(`Release download failed (${download.status}).`);
  const bytes = new Uint8Array(await download.arrayBuffer());
  verifyDigest(bytes, asset.digest);
  const archive = join(directory, "release.tar.gz");
  await writeFile(archive, bytes, { mode: 0o600 });
  validateArchive((await command("tar", ["-tzf", archive], true)).split("\n"));
  // Bundles contain regular files/directories only; reject links before extraction.
  const listing = await command("tar", ["-tvzf", archive], true);
  if (listing.split("\n").some((line) => !["-", "d"].includes(line[0] ?? "")))
    throw new Error(
      "Release archive contains unsupported links or special files.",
    );
  const unpacked = join(directory, "unpacked");
  await mkdir(unpacked, { mode: 0o700 });
  await command("tar", ["-xzf", archive, "--no-same-owner", "-C", unpacked]);
  const manifest = await readRelease(unpacked);
  if (
    `v${manifest.version}` !== release.tag_name ||
    (version && manifest.version !== version)
  )
    throw new Error("Release version does not match its GitHub tag.");
  return unpacked;
}
