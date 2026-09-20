import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  getDashboardPreference,
  listDatasets,
  saveDataset,
} from "../src/server/dashboards/store.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

test("mobile display settings share dashboard enablement and preserve saved content when disabled", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-display-settings-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const device = tokens.create("Display settings test");
  const handle = createMobileHandler(async () => {});
  const request = async (
    method: string,
    body?: unknown,
    extra: Record<string, string> = {},
    authorized = true,
  ) => {
    const response = await handle(
      new Request("https://roost.example/api/mobile/v1/settings/dashboards", {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(authorized ? { Authorization: `Bearer ${device.secret}` } : {}),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    assert.ok(response);
    return {
      status: response.status,
      headers: response.headers,
      value: await response.json(),
    };
  };
  const run = Effect.runPromise;
  try {
    assert.equal((await request("GET", undefined, {}, false)).status, 401);
    assert.equal(
      (await request("POST", { enabled: true }, {}, false)).status,
      401,
    );
    assert.equal(
      (
        await request(
          "POST",
          { enabled: true },
          { Origin: "https://roost.example" },
        )
      ).status,
      403,
    );
    const initial = await request("GET");
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.value, { enabled: false });
    assert.match(initial.headers.get("cache-control")!, /private, no-store/);
    assert.equal((await request("POST", { enabled: "yes" })).status, 400);
    assert.equal((await request("POST", {})).status, 400);
    assert.deepEqual((await request("POST", { enabled: true })).value, {
      enabled: true,
    });
    assert.deepEqual(await run(getDashboardPreference()), { enabled: true });
    const agentId = randomUUID();
    await run(
      saveAgent({
        id: agentId,
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "fixture",
      }),
    );
    await run(
      saveDataset(agentId, {
        key: "plan",
        title: "Plan",
        columns: [{ key: "task", label: "Task", type: "string" }],
        rows: [["Read"]],
      }),
    );
    assert.deepEqual((await request("POST", { enabled: false })).value, {
      enabled: false,
    });
    await assert.rejects(run(listDatasets(agentId)), /Dashboards are off/);
    await request("POST", { enabled: true });
    assert.equal((await run(listDatasets(agentId)))[0]?.rows[0]?.[0], "Read");
    assert.equal((await request("DELETE")).status, 405);
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1").run();
      }),
    );
    assert.equal((await request("POST", { enabled: false })).status, 400);
    assert.deepEqual(await run(getDashboardPreference()), { enabled: true });
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
