import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { saveAgent } from "../src/server/agents/store.server";
import { AuthStore } from "../src/server/auth/store.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

const directory = mkdtempSync(join(tmpdir(), "roost-mobile-production-"));
const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const origin = `http://localhost:${port}`;
const auth = new AuthStore(directory);
auth.setup(origin);
auth.close();
const tokens = new MobileTokens(directory);
const device = tokens.create("Production smoke fixture");
tokens.close();
await Effect.runPromise(
  saveAgent(
    {
      id: randomUUID(),
      name: "Fixture",
      character: "moss",
      instructions: "Fixture only",
      model: "fake",
    },
    directory,
  ),
);
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env: {
    ...process.env,
    ROOST_DATA_DIR: directory,
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "ignore", "ignore"],
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Production server exited.");
    try {
      ready = (await fetch(`${origin}/api/health`)).ok;
    } catch {
      /* startup */
    }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, "production server ready");
  const headers = { Authorization: `Bearer ${device.secret}` };
  const endpoint = `${origin}/api/mobile/v1`;
  assert.equal((await fetch(`${endpoint}/agents`)).status, 401);
  const agents = await fetch(`${endpoint}/agents`, { headers });
  assert.equal(agents.status, 200);
  assert.equal((await agents.json())[0].name, "Fixture");
  assert.equal((await fetch(`${endpoint}/payments`)).status, 401);
  const payments = await fetch(`${endpoint}/payments`, { headers });
  assert.equal(payments.status, 200);
  assert.match(payments.headers.get("cache-control")!, /no-store/);
  assert.deepEqual(await payments.json(), { connected: false, purchases: [] });
  for (const path of [
    "settings/notifications",
    "settings/dashboards",
    "notifications/push",
  ]) {
    assert.equal((await fetch(`${endpoint}/${path}`)).status, 401);
    const settings = await fetch(`${endpoint}/${path}`, { headers });
    assert.equal(settings.status, 200);
    assert.match(settings.headers.get("cache-control")!, /no-store/);
    const body = await settings.json();
    assert.equal(
      typeof body[path === "notifications/push" ? "configured" : "enabled"],
      "boolean",
    );
    assert.equal("deviceToken" in body, false);
  }
  assert.equal(
    (
      await fetch(`${endpoint}/payments/refresh`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${endpoint}/payments/connect`, {
        method: "POST",
        headers: {
          ...headers,
          Origin: "https://untrusted.example",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${endpoint}/agents`, {
        headers: { ...headers, Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${origin}/settings`, { headers, redirect: "manual" })).status,
    401,
  );
  assert.equal(
    (await fetch(`${endpoint}/session`, { method: "DELETE", headers })).status,
    200,
  );
  assert.equal((await fetch(`${endpoint}/agents`, { headers })).status, 401);
  console.log(
    "Production mobile smoke passed: token authentication, shared settings, native push status, payments, browser-route isolation, origin rejection, and revocation.",
  );
} finally {
  const stopped = new Promise<void>((resolve) =>
    server.once("exit", () => resolve()),
  );
  server.kill("SIGTERM");
  await Promise.race([stopped, delay(3000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await stopped;
  }
  rmSync(directory, { recursive: true, force: true });
}
