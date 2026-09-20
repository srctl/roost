import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { listAutomations } from "../src/server/automations/store.server";
import { mobileAutomationRequest } from "../src/server/mobile/automations.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import { listRuns } from "../src/server/runs/store.server";

test("mobile automations share schedules and runs, enforce ownership/revisions, and safely retry runs", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-automations-");
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    ROOST_CODEX_BINARY: process.env.ROOST_CODEX_BINARY,
  };
  Object.assign(process.env, {
    ROOST_DATA_DIR: directory,
    CODEX_HOME: directory,
    ROOST_CODEX_BINARY: fileURLToPath(
      new URL("./fixtures/chat-server.mjs", import.meta.url),
    ),
  });
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  const run = Effect.runPromise;
  const prepared: string[] = [];
  const request = async (path: string, method = "GET", data?: unknown) => {
    const result = await mobileAutomationRequest(
      path,
      new Request(`https://roost.example/api/mobile/v1/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      (request) => request.json(),
      async (agentId) => {
        prepared.push(agentId);
      },
    );
    assert.ok(result);
    return {
      status: result.status ?? 200,
      value: await new Response(JSON.stringify(result.value)).json(),
    };
  };
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const other = await run(
      saveAgent({
        id: randomUUID(),
        name: "Other",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const base = `agents/${agent.id}/automations`;
    const empty = await request(base);
    assert.deepEqual(empty.value, { automations: [], runs: [] });
    const models = await request(`${base}/models`);
    assert.ok(
      models.value.models.some(
        (model: { model: string }) => model.model === "gpt-5.6-luna",
      ),
    );
    assert.deepEqual(Object.keys(models.value), ["models"]);

    const schedules = [
      {
        kind: "weekly",
        time: "09:00",
        days: [1, 2, 3, 4, 5],
        timezone: "America/Los_Angeles",
      },
      { kind: "interval", minutes: 60, timezone: "UTC" },
      { kind: "cron", expression: "0 9 * * *", timezone: "Asia/Tokyo" },
      {
        kind: "once",
        at: new Date(Date.now() + 86400_000).toISOString(),
        timezone: "UTC",
      },
    ];
    for (const schedule of schedules) {
      const preview = await request(`${base}/preview`, "POST", { schedule });
      assert.equal(preview.status, 200);
      assert.equal(preview.value.runs.length, schedule.kind === "once" ? 1 : 3);
      assert.ok(preview.value.runs.every((at: number) => at > Date.now()));
    }
    for (const schedule of [
      { kind: "weekly", time: "09:00", days: [], timezone: "UTC" },
      { kind: "interval", minutes: 0, timezone: "UTC" },
      { kind: "interval", minutes: 60, timezone: "Bad/Zone" },
      { kind: "cron", expression: "not cron", timezone: "UTC" },
      {
        kind: "interval",
        minutes: 60,
        timezone: "UTC",
        startsOn: "2030-02-30",
      },
      { kind: "once", at: "2020-01-01T00:00:00Z", timezone: "UTC" },
    ])
      assert.equal(
        (await request(`${base}/preview`, "POST", { schedule })).status,
        400,
      );

    const input = {
      id: randomUUID(),
      agentId: other.id,
      name: "Morning report",
      prompt: "Report today’s priorities",
      model: "gpt-5.6-luna",
      notification: "when-needed",
      schedule: schedules[0],
    };
    const created = await request(base, "POST", input);
    assert.equal(created.status, 200);
    assert.equal(
      created.value.agentId,
      agent.id,
      "the route owns the agent identity",
    );
    assert.equal(created.value.model, "gpt-5.6-luna");
    assert.equal((await run(listAutomations(other.id))).length, 0);
    assert.equal(
      (await request(base, "POST", input)).value.revision,
      1,
      "creation retry is idempotent",
    );
    assert.equal(
      (await request(base, "POST", { ...input, name: "Conflicting create" }))
        .status,
      409,
    );
    assert.equal(
      (await request(base, "POST", { ...input, expectedRevision: 0 })).status,
      409,
    );
    assert.equal(
      (
        await request(base, "POST", {
          ...input,
          model: "unavailable",
          expectedRevision: 1,
        })
      ).status,
      400,
    );
    const edited = await request(base, "POST", {
      ...input,
      model: null,
      name: "Updated report",
      expectedRevision: 1,
    });
    assert.equal(
      edited.value.model,
      null,
      "explicit null restores the agent default",
    );
    assert.equal(edited.value.revision, 2);

    const entry = `${base}/${input.id}`;
    const foreign = `agents/${other.id}/automations/${input.id}`;
    assert.equal(
      (
        await request(`${foreign}/toggle`, "POST", {
          revision: 2,
          enabled: false,
        })
      ).status,
      409,
    );
    assert.equal(
      (await request(`${foreign}/run`, "POST", { requestId: randomUUID() }))
        .status,
      400,
    );
    assert.equal(
      (await request(foreign, "DELETE", { revision: 2 })).status,
      409,
    );
    const requestId = randomUUID();
    assert.equal(
      (await request(`${entry}/run`, "POST", { requestId })).status,
      202,
    );
    assert.equal(
      (await request(`${entry}/run`, "POST", { requestId })).value.id,
      requestId,
    );
    assert.equal((await run(listRuns(agent.id))).length, 1);
    assert.equal(
      (
        await request(`${entry}/toggle`, "POST", {
          revision: 2,
          enabled: false,
        })
      ).status,
      200,
    );
    const paused = (await request(base)).value.automations[0];
    assert.equal(paused.enabled, false);
    assert.equal(paused.nextRunAt, null);
    assert.equal((await run(listRuns(agent.id)))[0]?.status, "cancelled");
    assert.equal(
      (await request(`${entry}/toggle`, "POST", { revision: 2, enabled: true }))
        .status,
      409,
    );
    assert.equal(
      (await request(`${entry}/toggle`, "POST", { revision: 3, enabled: true }))
        .status,
      200,
    );

    const nextId = randomUUID();
    await request(`${entry}/run`, "POST", { requestId: nextId });
    const runPath = `agents/${agent.id}/runs/${nextId}`;
    assert.equal(
      (await request(`agents/${other.id}/runs/${nextId}`)).status,
      404,
    );
    const detail = await request(runPath);
    assert.equal(detail.value.prompt, input.prompt);
    assert.equal(detail.value.status, "queued");
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1").run();
      }),
    );
    assert.equal((await request(base)).status, 400);
    assert.equal(
      (await request(`${runPath}/stop`, "POST", {})).status,
      200,
      "stop remains available during maintenance",
    );
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runtime_control SET maintenance=0 WHERE id=1").run();
      }),
    );
    assert.equal((await request(runPath)).value.status, "cancelled");
    assert.equal((await request(entry, "DELETE", { revision: 3 })).status, 409);
    assert.equal((await request(entry, "DELETE", { revision: 4 })).status, 200);
    const deleted = await request(base);
    assert.equal(deleted.value.automations.length, 0);
    assert.equal(deleted.value.runs.length, 2, "deleting preserves history");
    assert.equal(deleted.value.runs[0].automationName, "Updated report");
    assert.equal((await request(base, "PATCH", {})).status, 405);
    assert.equal((await request("agents/not-a-uuid/automations")).status, 400);
    assert.ok(prepared.every((id) => id === agent.id));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("automation and history routes require mobile credentials and reject browser origins", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-automation-auth-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const device = tokens.create("Automation authentication test");
  const handle = createMobileHandler(async () => {});
  try {
    const agentId = randomUUID();
    await Effect.runPromise(
      saveAgent({
        id: agentId,
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "fixture",
      }),
    );
    const id = randomUUID();
    for (const [path, method] of [
      [`agents/${agentId}/automations`, "GET"],
      [`agents/${agentId}/automations`, "POST"],
      [`agents/${agentId}/automations/models`, "GET"],
      [`agents/${agentId}/automations/preview`, "POST"],
      [`agents/${agentId}/automations/${id}`, "DELETE"],
      [`agents/${agentId}/automations/${id}/toggle`, "POST"],
      [`agents/${agentId}/automations/${id}/run`, "POST"],
      [`agents/${agentId}/runs/${id}`, "GET"],
      [`agents/${agentId}/runs/${id}/stop`, "POST"],
    ] as const) {
      const url = `https://roost.example/api/mobile/v1/${path}`;
      const unauthorized = await handle(new Request(url, { method }));
      assert.equal(unauthorized?.status, 401);
      const browser = await handle(
        new Request(url, {
          method,
          headers: {
            Authorization: `Bearer ${device.secret}`,
            Origin: "https://roost.example",
          },
        }),
      );
      assert.equal(browser?.status, 403);
    }
    const response = await handle(
      new Request(
        `https://roost.example/api/mobile/v1/agents/${agentId}/automations`,
        { headers: { Authorization: `Bearer ${device.secret}` } },
      ),
    );
    assert.equal(response?.status, 200);
    assert.match(response!.headers.get("cache-control")!, /private, no-store/);
    assert.deepEqual(await response!.json(), { automations: [], runs: [] });
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
