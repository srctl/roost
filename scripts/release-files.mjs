import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

// Materialize dependencies explicitly: recursive cpSync can preserve nested
// symlinks even with dereference enabled in the pinned Node runtime.
export function copyReleaseTree(source, target, ancestors = new Set()) {
  const resolved = realpathSync(source);
  const info = statSync(resolved);
  if (info.isFile()) {
    copyFileSync(resolved, target);
    return;
  }
  if (!info.isDirectory())
    throw new Error(`Unsupported release file: ${source}`);
  if (ancestors.has(resolved))
    throw new Error(`Cyclic release link: ${source}`);
  const parents = new Set([...ancestors, resolved]);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(resolved))
    copyReleaseTree(join(resolved, entry), join(target, entry), parents);
}

export function validateReleaseArchive(archive) {
  const listing = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" });
  if (
    listing
      .trim()
      .split("\n")
      .some((line) => !["-", "d"].includes(line[0]))
  )
    throw new Error(
      "Release archive contains unsupported links or special files.",
    );
}
