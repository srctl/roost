import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { updaterRequest } from "../src/updater/client";

test("real private Unix transport bounds requests and routes responses through the credential-checking bridge", async () => {
  const root = await mkdtemp("/tmp/roost-socket-");
  const directory = join(root, "updates");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { mode: 0o700 });
  const child = spawn(
    "/usr/bin/python3",
    ["src/updater/peer-broker.py", join(directory, "helper.sock")],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const reader = createInterface({ input: child.stdout });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  reader.on("line", (line) => {
    const frame = JSON.parse(line);
    if (frame.ready) {
      ready();
      return;
    }
    child.stdin.write(
      JSON.stringify({
        id: frame.id,
        result: {
          value: {
            seen: frame.message.action,
            protocol: frame.message.protocol,
          },
        },
      }) + "\n",
    );
  });
  try {
    await started;
    assert.equal(
      (await stat(join(directory, "helper.sock"))).mode & 0o777,
      0o600,
    );
    assert.deepEqual(await updaterRequest(root, { action: "status" }), {
      seen: "status",
      protocol: 1,
    });
    await assert.rejects(
      updaterRequest(root, { action: "status", payload: "x".repeat(9000) }),
      /too large/,
    );
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    reader.close();
    await rm(root, { recursive: true, force: true });
  }
});
