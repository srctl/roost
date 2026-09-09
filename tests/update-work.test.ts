import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { codingWorkUncertain, systemdAdapter } from "../src/updater/systemd";

test("coding quiescence requires fresh verified idle identity; labels never substitute", () => {
  const now = 100000;
  const idle = {
    status: "review",
    observedWorking: 1,
    lastWorkerState: "idle",
    sessionIdentity: "owner",
    nativeSessionId: "session",
    lastCheckedAt: now,
    cancelRequested: 0,
  };
  assert.equal(codingWorkUncertain(idle, now), false);
  assert.equal(
    codingWorkUncertain({ ...idle, lastWorkerState: "done" }, now),
    false,
  );
  for (const patch of [
    { status: "blocked" },
    { status: "running" },
    { observedWorking: 0 },
    { lastWorkerState: "working" },
    { lastWorkerState: "missing" },
    { lastWorkerState: "unknown" },
    { lastWorkerState: null },
    { lastCheckedAt: now - 15001 },
    { lastCheckedAt: undefined },
    { sessionIdentity: null },
    { nativeSessionId: null },
    { cancelRequested: 1 },
    { error: "identity changed" },
  ])
    assert.equal(
      codingWorkUncertain({ ...idle, ...patch }, now),
      true,
      JSON.stringify(patch),
    );
  assert.equal(
    codingWorkUncertain(
      { status: "blocked", lastWorkerState: "not_started" },
      now,
    ),
    false,
  );
  assert.equal(
    codingWorkUncertain(
      { ...idle, status: "blocked", lastWorkerState: "not_started" },
      now,
    ),
    true,
  );
});

test("unavailable work storage defers instead of granting quiescence", async () => {
  const root = await mkdtemp("/tmp/roost-work-unavailable-");
  try {
    const adapter = systemdAdapter(
      { root, user: "test", uid: 1000, home: root, port: 12345 },
      root,
    );
    assert.deepEqual(await adapter.blockers(false), [
      "Work cannot be verified because its store is unavailable.",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
