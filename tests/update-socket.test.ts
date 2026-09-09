import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
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
    const reply = () =>
      child.stdin.write(
        `${JSON.stringify({
          id: frame.id,
          result: {
            value: {
              seen: frame.message.action,
              protocol: frame.message.protocol,
            },
          },
        })}\n`,
      );
    if (frame.message.action === "repair") setTimeout(reply, 21000);
    else reply();
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
    // Exceeds both former 18-second broker and 20-second client limits. Status
    // must still be observable while the same connection waits for repair.
    const repair = updaterRequest(root, { action: "repair" });
    await delay(100);
    const observed = await Promise.race([
      updaterRequest(root, { action: "status" }),
      delay(5000).then(() => {
        throw new Error("Status was blocked by the pending repair.");
      }),
    ]);
    assert.deepEqual(observed, {
      seen: "status",
      protocol: 1,
    });
    assert.deepEqual(await repair, { seen: "repair", protocol: 1 });
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
    reader.close();
    await rm(root, { recursive: true, force: true });
  }
});
