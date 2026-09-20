import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { readAgentNavigation } from "../src/server/agents/navigation.server";
import { listAgents, withAgentStore } from "../src/server/agents/store.server";
import { createMobileAgentManagementRequest } from "../src/server/mobile/agent-management.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import { enqueueChat } from "../src/server/runs/store.server";

const models = {
  models: [{ model: "fixture-model", displayName: "Fixture", isDefault: true }],
};

test("mobile agent creation, rename, navigation and deletion use the shared stores and preserve safety fences", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-agents-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const handle = createMobileAgentManagementRequest(Effect.succeed(models));
  const request = (path: string, method = "GET", body?: unknown) =>
    handle(
      path,
      new Request(`https://roost.example/api/mobile/v1/${path}`, { method }),
      async () => body,
    );
  try {
    assert.deepEqual((await request("agent-options"))?.value, {
      ...models,
      characters: [
        "moss",
        "wisp",
        "peach",
        "sprout",
        "ember",
        "puddle",
        "pip",
        "bloom",
        "pebble",
        "button",
        "nimbus",
        "acorn",
      ],
    });
    const agent = {
      id: randomUUID(),
      name: "Scout",
      instructions: "Research options",
      model: "fixture-model",
      character: "moss" as const,
      kind: "assistant" as const,
    };
    assert.equal((await request("agents", "POST", agent))?.status, 201);
    assert.equal(
      (await request("agents", "POST", agent))?.status,
      201,
      "retry keeps a single creation",
    );
    assert.equal((await Effect.runPromise(listAgents())).length, 1);
    await assert.rejects(
      request("agents", "POST", { ...agent, name: "Changed" }),
      /already used/,
    );
    await assert.rejects(
      request("agents", "POST", {
        ...agent,
        id: randomUUID(),
        model: "unavailable",
      }),
      /no longer available/,
    );
    await assert.rejects(
      request("agents", "POST", {
        ...agent,
        id: randomUUID(),
        instructions: "",
      }),
    );
    await request(`agents/${agent.id}/name`, "POST", {
      name: "  Research  ",
      agentId: randomUUID(),
    });
    assert.equal(
      (await Effect.runPromise(listAgents()))[0]?.name,
      "Research",
      "path owns rename even with a spoofed body owner",
    );
    const sectionId = randomUUID();
    await request("agent-navigation", "POST", {
      action: "create",
      id: sectionId,
      name: "Work",
    });
    await request("agent-navigation", "POST", {
      action: "move",
      agentId: agent.id,
      sectionId,
    });
    const collapsed = await request("agent-navigation", "POST", {
      action: "collapse",
      id: sectionId,
      collapsed: true,
    });
    assert.deepEqual(
      collapsed?.value,
      await Effect.runPromise(readAgentNavigation()),
    );
    assert.equal(
      (await Effect.runPromise(readAgentNavigation())).memberships[agent.id],
      sectionId,
    );
    await assert.rejects(
      request(`agents/${agent.id}`, "DELETE", { name: "Scout" }),
      /changed/,
    );
    const runId = randomUUID();
    await Effect.runPromise(
      enqueueChat({ agentId: agent.id, messageId: runId, text: "Research" }),
    );
    await Effect.runPromise(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET status='running' WHERE id=?").run(runId),
      ),
    );
    assert.deepEqual((await request("agent-activity"))?.value, {
      [agent.id]: "working",
    });
    await assert.rejects(
      request(`agents/${agent.id}`, "DELETE", { name: "Research" }),
      /active turn/,
    );
    assert.equal((await Effect.runPromise(listAgents())).length, 1);
    await Effect.runPromise(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET status='cancelled' WHERE id=?").run(runId),
      ),
    );
    assert.deepEqual(
      (await request(`agents/${agent.id}`, "DELETE", { name: "Research" }))
        ?.value,
      { ok: true },
    );
    assert.equal((await Effect.runPromise(listAgents())).length, 0);
    assert.deepEqual(
      (await request(`agents/${agent.id}`, "DELETE", { name: "Research" }))
        ?.value,
      { ok: true },
      "deletion retry is idempotent",
    );
    await assert.rejects(
      request("agents", "POST", { ...agent, name: "Research" }),
      /deleted/,
    );
    assert.equal((await request("agent-navigation", "PATCH"))?.status, 405);
    assert.equal(await request(`agents/${randomUUID()}/conversation`), null);
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("agent management routes require device authentication and reject browser requests", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-agent-auth-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const token = tokens.create("Native test");
  const handle = createMobileHandler(async () => {});
  try {
    for (const [path, method] of [
      ["agent-options", "GET"],
      ["agent-navigation", "POST"],
      ["agent-activity", "GET"],
      ["agents", "POST"],
      [`agents/${randomUUID()}/name`, "POST"],
      [`agents/${randomUUID()}`, "DELETE"],
    ]) {
      assert.equal(
        (
          await handle(
            new Request(`https://roost.example/api/mobile/v1/${path}`, {
              method,
            }),
          )
        )?.status,
        401,
      );
      assert.equal(
        (
          await handle(
            new Request(`https://roost.example/api/mobile/v1/${path}`, {
              method,
              headers: {
                Authorization: `Bearer ${token.secret}`,
                Origin: "https://roost.example",
              },
            }),
          )
        )?.status,
        403,
      );
    }
    const response = await handle(
      new Request("https://roost.example/api/mobile/v1/agent-navigation", {
        headers: { Authorization: `Bearer ${token.secret}` },
      }),
    );
    assert.equal(response?.status, 200);
    assert.match(response?.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mobile identity and coding settings share conflict checks, path ownership, history and execution profiles", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-identity-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const handle = createMobileAgentManagementRequest(Effect.succeed(models));
  const request = (path: string, method = "GET", body?: unknown) =>
    handle(
      path,
      new Request(`https://roost.example/api/mobile/v1/${path}`, { method }),
      async () => body,
    );
  try {
    const agent = {
      id: randomUUID(),
      name: "Wisp",
      instructions: "Build things",
      model: "fixture-model",
      character: "wisp",
      kind: "coding",
    };
    await request("agents", "POST", agent);
    const identity = (await request(`agents/${agent.id}/identity`))?.value as {
      soul: { content: string; revision: string };
      changes: { id: string }[];
      reflection: { intervalMinutes: number };
    };
    assert.match(identity.soul.content, /Build things/);
    const edited = {
      content: `${identity.soul.content}\nPrefer verified results.`,
      revision: identity.soul.revision,
      agentId: randomUUID(),
    };
    await request(`agents/${agent.id}/soul`, "POST", edited);
    await assert.rejects(
      request(`agents/${agent.id}/soul`, "POST", {
        ...edited,
        content: "stale",
      }),
      /changed while/,
    );
    const changed = (await request(`agents/${agent.id}/identity`))
      ?.value as typeof identity;
    assert.equal(changed.changes.length, 1);
    await request(`agents/${agent.id}/soul-undo`, "POST", {
      id: changed.changes[0]!.id,
    });
    const undone = (await request(`agents/${agent.id}/identity`))
      ?.value as typeof identity;
    assert.equal(undone.soul.content, identity.soul.content);
    const reflection = (
      await request(`agents/${agent.id}/reflection`, "POST", {
        intervalMinutes: 1440,
        agentId: randomUUID(),
      })
    )?.value as { intervalMinutes: number };
    assert.equal(reflection.intervalMinutes, 1440);
    const requestId = randomUUID();
    assert.deepEqual(
      (await request(`agents/${agent.id}/reflect`, "POST", { requestId }))
        ?.value,
      { id: requestId },
    );
    assert.deepEqual(
      (await request(`agents/${agent.id}/reflect`, "POST", { requestId }))
        ?.value,
      { id: requestId },
    );
    const profile = {
      id: randomUUID(),
      name: "Development",
      kind: "ssh",
      target: "dev@example.com",
      instructions: "Run tests",
      revision: 0,
    };
    const savedProfile = (await request("execution-profiles", "POST", profile))
      ?.value as typeof profile;
    assert.equal(savedProfile.revision, 1);
    await assert.rejects(
      request("execution-profiles", "POST", profile),
      /changed/,
    );
    await assert.rejects(
      request("execution-profiles", "POST", {
        ...profile,
        id: randomUUID(),
        target: "host;rm -rf /",
      }),
      /SSH target/,
    );
    const configuration = (await request(`agents/${agent.id}/coding-settings`))
      ?.value as {
      settings: { agentId: string; revision: number };
      profiles: unknown[];
    };
    assert.equal(configuration.settings.agentId, agent.id);
    assert.equal(configuration.profiles.length, 1);
    const settings = {
      agentId: randomUUID(),
      repository: "https://github.com/example/project",
      projectInstructions: "Use pnpm",
      defaultProfileId: profile.id,
      sources: [
        {
          id: "issues",
          name: "Issues",
          databaseUrl: "https://github.com/example/project/issues",
          filter: "Ready",
          instructions: "Pick one",
        },
      ],
      revision: 0,
    };
    const saved = (
      await request(`agents/${agent.id}/coding-settings`, "POST", settings)
    )?.value as typeof settings;
    assert.equal(saved.agentId, agent.id);
    assert.equal(saved.revision, 1);
    await assert.rejects(
      request(`agents/${agent.id}/coding-settings`, "POST", settings),
      /changed/,
    );
    await assert.rejects(
      request(`execution-profiles/${profile.id}`, "DELETE", { revision: 0 }),
      /changed/,
    );
    await request(`execution-profiles/${profile.id}`, "DELETE", {
      revision: 1,
    });
    const afterDelete = (await request(`agents/${agent.id}/coding-settings`))
      ?.value as { settings: typeof settings };
    assert.equal(afterDelete.settings.defaultProfileId, null);
    assert.equal(afterDelete.settings.revision, 2);
    assert.equal(afterDelete.settings.sources[0]?.name, "Issues");
    assert.equal(
      (await request(`agents/${agent.id}/coding-settings`, "PATCH"))?.status,
      405,
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
