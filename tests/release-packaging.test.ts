import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  copyReleaseTree,
  validateReleaseArchive,
} from "../scripts/release-files.mjs";

test("packaging materializes nested dependency links into a standalone archive", () => {
  const root = mkdtempSync(join(tmpdir(), "roost-package-"));
  try {
    const source = join(root, "source");
    const store = join(source, "node_modules/.store/tslib");
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, "index.js"), "export const helper = true;");
    writeFileSync(join(source, "start"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    symlinkSync(".store/tslib", join(source, "node_modules/tslib"));
    symlinkSync("index.js", join(store, "alias.js"));
    linkSync(join(store, "index.js"), join(store, "hard.js"));
    const bundle = join(root, "bundle");
    copyReleaseTree(source, bundle);
    const copied = join(bundle, "node_modules/tslib");
    assert.equal(lstatSync(copied).isDirectory(), true);
    assert.equal(lstatSync(join(copied, "alias.js")).isFile(), true);
    assert.equal(lstatSync(join(bundle, "start")).mode & 0o111, 0o111);
    const archive = join(root, "release.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", bundle, "."]);
    validateReleaseArchive(archive);
    rmSync(source, { recursive: true });
    const unpacked = join(root, "unpacked");
    mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
    assert.equal(
      readFileSync(join(unpacked, "node_modules/tslib/alias.js"), "utf8"),
      "export const helper = true;",
    );
    symlinkSync(bundle, join(bundle, "cycle"));
    assert.throws(
      () => copyReleaseTree(bundle, join(root, "cyclic")),
      /Cyclic/,
    );
    execFileSync("tar", ["-czf", archive, "-C", bundle, "."]);
    assert.throws(() => validateReleaseArchive(archive), /unsupported links/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
