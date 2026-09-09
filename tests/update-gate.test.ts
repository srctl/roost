import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { AuthStore } from "../src/server/auth/store.server";
import {
  trackUpdateRequest,
  updateGateRequest,
} from "../src/server/update-gate.server";
import { startupGuard, writeGate } from "../src/updater/gate";

test("boot and candidate gates reject stale readiness, ordinary HTTP/auth and in-flight quiescence", async () => {
  const root = await mkdtemp("/tmp/roost-gate-");
  const previous = {
    ROOST_HOME: process.env.ROOST_HOME,
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
  };
  process.env.ROOST_HOME = root;
  process.env.ROOST_DATA_DIR = join(root, "data");
  try {
    await mkdir(join(root, "updates"));
    await writeFile(join(root, "updater.json"), "{}");
    const boot = (
      await readFile("/proc/sys/kernel/random/boot_id", "utf8")
    ).trim();
    await writeFile(
      join(root, "updates", "ready.json"),
      JSON.stringify({ boot: "old-boot" }),
    );
    await writeGate(root, { protocol: 1, operation: null, mode: "open" });
    assert.throws(() => startupGuard(root, "0.1.41", undefined));
    await writeFile(
      join(root, "updates", "ready.json"),
      JSON.stringify({ boot }),
    );
    startupGuard(root, "0.1.41", undefined);
    await writeGate(root, {
      protocol: 1,
      operation: "operation",
      mode: "verify",
      version: "0.1.41",
      token: "private-capability",
    });
    assert.throws(() => startupGuard(root, "0.1.41", undefined));
    assert.throws(() => startupGuard(root, "0.1.40", "private-capability"));
    startupGuard(root, "0.1.41", "private-capability");
    for (const path of [
      "/",
      "/api/health",
      "/auth",
      "/auth/api/login-options",
      "/api/updates",
      "/api/updates/probe",
      "/_serverFn/mutation",
      "/api/desktop/socket",
    ]) {
      const response = await updateGateRequest(
        new Request(`http://localhost${path}`),
      );
      assert.equal(response?.status, 503, path);
    }
    let release!: () => void;
    const action = trackUpdateRequest(async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return new Response();
    });
    const probe = () =>
      updateGateRequest(
        new Request("http://localhost/api/updates/quiescence", {
          headers: { "X-Roost-Updater": "private-capability" },
        }),
      );
    const during = await (await probe())!.json();
    assert.equal(during.requests, 1);
    assert.equal(during.frozen, true);
    release();
    await action;
    assert.equal((await (await probe())!.json()).requests, 0);
    await writeFile(join(root, "updates", "gate.json"), "corrupt");
    assert.throws(() => startupGuard(root, "0.1.41", "private-capability"));
    assert.equal(
      (await updateGateRequest(new Request("http://localhost/auth")))?.status,
      503,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate probes validate referenced assets and actual native-auth storage before commit", async () => {
  const root = await mkdtemp("/tmp/roost-probe-");
  const keys = [
    "ROOST_HOME",
    "ROOST_DATA_DIR",
    "ROOST_PUBLIC_DIR",
    "ROOST_RELEASE_VERSION",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, {
    ROOST_HOME: root,
    ROOST_DATA_DIR: join(root, "data"),
    ROOST_PUBLIC_DIR: join(root, "public"),
    ROOST_RELEASE_VERSION: "0.1.41",
  });
  try {
    await mkdir(join(root, "updates"));
    await mkdir(join(root, "public", "assets"), { recursive: true });
    await writeFile(join(root, "updater.json"), "{}");
    await writeFile(
      join(root, "updates", "ready.json"),
      JSON.stringify({
        boot: (
          await readFile("/proc/sys/kernel/random/boot_id", "utf8")
        ).trim(),
      }),
    );
    const auth = new AuthStore(join(root, "data"));
    auth.setup("http://localhost:4195");
    auth.close();
    await writeGate(root, {
      protocol: 1,
      operation: "probe",
      mode: "verify",
      version: "0.1.41",
      token: "probe-capability",
    });
    for (const name of ["main.js", "decoy.js", "main.css"])
      await writeFile(join(root, "public", "assets", name), "fixture");
    const probe = () =>
      updateGateRequest(
        new Request("http://localhost/api/updates/probe", {
          headers: { "X-Roost-Updater": "probe-capability" },
        }),
        () =>
          new Response(
            '<html>Software updates<link href="/assets/main.css"><script src="/assets/main.js"></script></html>',
            { headers: { "Content-Type": "text/html" } },
          ),
      );
    const healthy = await (await probe())!.json();
    assert.equal(healthy.integrity, true);
    assert.equal(healthy.assets, true);
    assert.equal(healthy.shell, true);
    await rm(join(root, "public", "assets", "main.js"));
    assert.equal((await (await probe())!.json()).assets, false);
    const db = new DatabaseSync(join(root, "data", "auth.sqlite"));
    db.exec("UPDATE config SET value='malformed'");
    db.close();
    await assert.rejects(probe());
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
