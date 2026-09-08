/** Disposable-guest-only lifecycle driver. Never used by application or helper.
 * Bundle with Vite SSR and run as the guest installation user in its own systemd
 * unit. The guest must have the explicit marker below and this exact test root. */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { UpdateEngine } from "../src/updater/engine";
import { readGate } from "../src/updater/gate";
import { durableJson } from "../src/updater/journal";
import { parseOffer } from "../src/updater/releases";
import { systemdAdapter } from "../src/updater/systemd";

const root = "/home/ubuntu/roost-update-test";
if (!existsSync("/etc/roost-update-disposable") || process.getuid?.() !== 1000)
  throw new Error(
    "This driver requires the explicitly marked disposable Ubuntu guest.",
  );
const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
if (config.root !== root || config.user !== "ubuntu")
  throw new Error("Fixture installation mismatch.");
const [version = "0.1.41", boundary = "none", mode = "run"] =
  process.argv.slice(2);
const adapter = systemdAdapter(config, join(root, "current", "cli"));
const readyDeadline = Date.now() + 120000;
while (true) {
  const open = readGate(root).mode === "open";
  let healthy = false;
  if (open) {
    if (!(await adapter.running())) healthy = true;
    else
      try {
        healthy = (
          await fetch(`http://127.0.0.1:${config.port}/api/health`, {
            signal: AbortSignal.timeout(2000),
          })
        ).ok;
      } catch {
        /* Wait for the test app. */
      }
  }
  if (healthy) break;
  if (Date.now() > readyDeadline)
    throw new Error("Disposable fixture did not become ready.");
  await delay(500);
}
// Artifacts are preinstalled copies of the built package in this lifecycle test.
// Network pinning and hostile archive rejection have separate isolated tests.
adapter.stage = async () => {};
const engine = new UpdateEngine(root, adapter, 30000, async (phase) => {
  if (phase !== boundary) return;
  await durableJson(join(root, "boundary.json"), { phase, mode });
  if (mode === "kill") process.kill(process.pid, "SIGKILL");
  if (mode === "reboot") await new Promise(() => setInterval(() => {}, 1000));
});
const offer = parseOffer(
  {
    id: 1,
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        id: 2,
        name: "roost-linux-x64.tar.gz",
        size: 1,
        digest: `sha256:${"a".repeat(64)}`,
        url: "https://api.github.com/repos/srctl/roost/releases/assets/2",
      },
    ],
  },
  "srctl/roost",
  Date.now(),
);
const operation = await engine.accept({
  actor: "b".repeat(64),
  key: randomUUID(),
  offer,
  confirmedVersion: version,
});
await writeFile(join(root, "test-operation"), operation.id, { mode: 0o600 });
await engine.settled();
console.log(JSON.stringify(await engine.status()));
