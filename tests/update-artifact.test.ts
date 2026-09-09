import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";

function archive(name: string, type = "0", contents = "hello") {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100);
  header.write(`${contents.length.toString(8).padStart(11, "0")}\0`, 124);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write("ustar\0", 257);
  const sum = header.reduce((a, b) => a + b, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return gzipSync(
    Buffer.concat([
      header,
      Buffer.from(contents),
      Buffer.alloc((512 - (contents.length % 512)) % 512),
      Buffer.alloc(1024),
    ]),
  );
}
test("bounded extractor accepts regular GNU/ustar files and refuses path/link/device/extension attacks", async () => {
  const root = await mkdtemp("/tmp/roost-extraction-");
  try {
    const file = join(root, "release.gz");
    await writeFile(file, archive("./directory/file"));
    execFileSync(
      "/usr/bin/python3",
      ["src/updater/extract.py", file, join(root, "good")],
      { stdio: "pipe" },
    );
    assert.equal(
      await readFile(join(root, "good/directory/file"), "utf8"),
      "hello",
    );
    let n = 0;
    for (const [name, type] of [
      ["../escape", "0"],
      ["/absolute", "0"],
      ["link", "2"],
      ["hardlink", "1"],
      ["device", "3"],
      ["pax", "x"],
      ["file", "6"],
    ]) {
      await writeFile(file, archive(name!, type));
      assert.throws(() =>
        execFileSync(
          "/usr/bin/python3",
          ["src/updater/extract.py", file, join(root, `bad-${n++}`)],
          { stdio: "pipe" },
        ),
      );
    }
    await writeFile(file, gzipSync(Buffer.alloc(700)));
    assert.throws(() =>
      execFileSync(
        "/usr/bin/python3",
        ["src/updater/extract.py", file, join(root, "truncated")],
        { stdio: "pipe" },
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
