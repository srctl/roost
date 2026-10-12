import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DesktopRequest } from "@roost/desktop-protocol";
import { Effect } from "effect";
import { LocalTools } from "../../desktop/src/local-tools";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { FEED_EDITOR_AUTOMATION_ID } from "../src/server/codex/run-capabilities.server";
import { companionBroker } from "../src/server/companion/broker.server";
import { handleCompanionTool } from "../src/server/companion/tools.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import { insertRun } from "../src/server/runs/store.server";

test("desktop companion authenticates, reads only shared chats, checks real run policies, and stops on revocation", async () => {
  const root = mkdtempSync(join(tmpdir(), "roost-companion-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  const handle = createMobileHandler(async () => {});
  const tokens = new MobileTokens(root);
  const device = tokens.create("Test Mac");
  const agentId = randomUUID();
  const runId = randomUUID();
  const call = (
    path: string,
    data: unknown,
    headers: Record<string, string> = {},
  ) =>
    handle(
      new Request(`https://roost.example/api/mobile/v1/companion/${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${device.secret}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(data),
      }),
    );
  try {
    await Effect.runPromise(
      saveAgent({
        id: agentId,
        name: "Moss",
        character: "moss",
        instructions: "Help",
        model: "fake",
      }),
    );
    await Effect.runPromise(
      withAgentStore((db) => {
        insertRun(db, { id: runId, agentId, prompt: "Read shared chat" });
        db.prepare("UPDATE runs SET status='running' WHERE id=?").run(runId);
      }),
    );
    assert.equal(
      (await call("connect", {}, { Authorization: "Bearer invalid" }))?.status,
      401,
    );
    assert.equal(
      (await call("connect", {}, { Origin: "https://evil.example" }))?.status,
      403,
    );
    const { lease } = await (await call("connect", {}))!.json();
    const grants = {
      agentId,
      chats: [{ id: 7, label: "Selected conversation" }],
      computerUntil: 0,
    };
    assert.equal((await call("poll", { lease, grants }))?.status, 200);
    const tools = new LocalTools(
      "unused",
      async (_program, args) => {
        assert.deepEqual(args, [
          "history",
          "--chat-id",
          "7",
          "--limit",
          "30",
          "--json",
        ]);
        return JSON.stringify({
          id: 2,
          text: "Meet at 3",
          sender_name: "A friend",
          is_from_me: false,
          created_at: "2026-10-12T12:00:00Z",
          attachments: [{ path: "/private/attachment" }],
        });
      },
      "fixture-imsg",
    );
    tools.setGrants(grants);
    const signal = new AbortController().signal;
    const pending = handleCompanionTool(
      agentId,
      runId,
      "roost_desktop_messages",
      { action: "history", chatId: 7 },
      signal,
    );
    // Polling can race the database authorization before the request is queued.
    let request: DesktopRequest | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await (await call("poll", { lease, grants }))!.json();
      request = response.requests[0];
      if (request) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(request);
    const result = await tools.handle(request);
    assert.equal(
      (await call("result", { lease, id: request.id, result }))?.status,
      200,
    );
    const response = await pending;
    assert.equal(response.success, true);
    assert.match(JSON.stringify(response), /Meet at 3/);
    assert.doesNotMatch(JSON.stringify(response), /private\/attachment/);
    assert.equal(
      (await call("result", { lease, id: request.id, result }))?.status,
      400,
    );
    const forbiddenChat = await handleCompanionTool(
      agentId,
      runId,
      "roost_desktop_messages",
      { action: "history", chatId: 8 },
      signal,
    );
    assert.equal(forbiddenChat.success, false);
    const computer = await handleCompanionTool(
      agentId,
      runId,
      "roost_desktop_computer",
      { action: "screenshot" },
      signal,
    );
    assert.equal(computer.success, false);
    for (const kind of ["handoff", "reflection", "automation"] as const) {
      await Effect.runPromise(
        withAgentStore((db) =>
          db
            .prepare("UPDATE runs SET kind=?,automationId=? WHERE id=?")
            .run(
              kind,
              kind === "automation" ? FEED_EDITOR_AUTOMATION_ID : null,
              runId,
            ),
        ),
      );
      const forbidden = await handleCompanionTool(
        agentId,
        runId,
        "roost_desktop_messages",
        { action: "chats" },
        signal,
      );
      assert.equal(forbidden.success, false);
      assert.match(JSON.stringify(forbidden), /cannot access/);
    }
    await Effect.runPromise(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE runs SET kind='chat',automationId=NULL,cancelRequested=1 WHERE id=?",
          )
          .run(runId),
      ),
    );
    assert.equal(
      (
        await handleCompanionTool(
          agentId,
          runId,
          "roost_desktop_messages",
          { action: "chats" },
          signal,
        )
      ).success,
      false,
    );
    await Effect.runPromise(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET cancelRequested=0 WHERE id=?").run(runId),
      ),
    );
    tokens.revoke(device.id);
    assert.equal((await call("poll", { lease, grants }))?.status, 401);
    assert.equal(
      (
        await handleCompanionTool(
          agentId,
          runId,
          "roost_desktop_messages",
          { action: "chats" },
          signal,
        )
      ).success,
      false,
    );
  } finally {
    companionBroker.disconnect(device.id);
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
