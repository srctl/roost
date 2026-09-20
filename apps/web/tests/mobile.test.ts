import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { createApproval } from "../src/server/approvals/store.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import { putMessage } from "../src/server/runs/timeline.server";

// Exercise real stores and HTTP validation without starting a Codex worker.
test("native API authenticates independently, preserves retry identity and thread scope, resolves approvals, and revokes devices", async () => {
  const root = mkdtempSync(join(tmpdir(), "roost-mobile-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  const handle = createMobileHandler(async () => {});
  const run = Effect.runPromise;
  const tokens = new MobileTokens(root);
  try {
    const device = tokens.create("Test iPhone");
    assert.ok(
      !readFileSync(join(root, "mobile.sqlite")).includes(device.secret),
    );
    const request = (
      path: string,
      method = "GET",
      data?: unknown,
      headers: Record<string, string> = {},
    ) =>
      handle(
        new Request(`https://roost.example/api/mobile/v1/${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${device.secret}`,
            ...(data === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...headers,
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        }),
      );
    assert.equal(
      (await handle(new Request("https://roost.example/api/mobile/v1/agents")))
        ?.status,
      401,
    );
    assert.equal(
      (
        await request("agents", "GET", undefined, {
          Authorization: "Bearer invalid",
        })
      )?.status,
      401,
    );
    assert.equal(
      (
        await request("agents", "GET", undefined, {
          Origin: "https://evil.example",
        })
      )?.status,
      403,
    );
    assert.equal((await request("session"))?.status, 200);
    assert.equal(
      await handle(new Request("https://roost.example/settings")),
      null,
    );
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Moss",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const other = await run(
      saveAgent({
        id: randomUUID(),
        name: "Wisp",
        instructions: "Help",
        character: "wisp",
        model: "fake",
      }),
    );
    assert.equal((await (await request("agents"))!.json()).length, 2);
    const path = `agents/${agent.id}/`;
    const rejected = await request(`${path}messages`, "POST", {
      messageId: randomUUID(),
      text: "🌱".repeat(16001),
    });
    assert.equal(rejected?.status, 400);
    assert.equal((await rejected!.json()).code, "message_rejected");
    assert.equal(
      (await (await request(`${path}conversation`))!.json()).entries.length,
      0,
    );
    const missingFile = await request(`${path}messages`, "POST", {
      messageId: randomUUID(),
      text: "",
      attachmentIds: [randomUUID()],
    });
    assert.equal(missingFile?.status, 400);
    assert.equal((await missingFile!.json()).code, "message_rejected");
    assert.equal(
      (await (await request(`${path}conversation`))!.json()).entries.length,
      0,
    );
    const input = { messageId: randomUUID(), text: "Plan the week" };
    assert.equal(
      (await request(`${path}messages`, "POST", input))?.status,
      202,
    );
    assert.equal(
      (await request(`${path}messages`, "POST", input))?.status,
      202,
    );
    const conflict = await request(`${path}messages`, "POST", {
      ...input,
      text: "Changed",
    });
    assert.equal(conflict?.status, 400);
    assert.equal(
      (await conflict!.json()).code,
      undefined,
      "An existing request cannot be classified as never enqueued",
    );
    let snapshot = await (await request(`${path}conversation`))!.json();
    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.entries[0].message.text, input.text);
    assert.equal(
      (
        await request(`${path}threads`, "POST", {
          parentMessageId: input.messageId,
        })
      )?.status,
      400,
    );
    await run(
      withAgentStore((db) =>
        putMessage(db, agent.id, {
          id: "reply-parent",
          role: "assistant",
          text: "Here is the plan.",
        }),
      ),
    );
    const thread = await (await request(`${path}threads`, "POST", {
      parentMessageId: "reply-parent",
    }))!.json();
    assert.equal(
      (
        await request(
          `agents/${other.id}/conversation?conversationId=${thread.id}`,
        )
      )?.status,
      400,
    );
    assert.equal((await request(`${path}conversation?since=-1`))?.status, 400);
    assert.equal(
      (
        await request(`${path}messages`, "POST", {
          messageId: randomUUID(),
          text: "Reply only",
          conversationId: thread.id,
        })
      )?.status,
      202,
    );
    const replies = await (await request(
      `${path}conversation?conversationId=${thread.id}`,
    ))!.json();
    assert.equal(replies.entries.length, 1);
    assert.equal(replies.entries[0].message.text, "Reply only");
    await run(
      withAgentStore((db) => {
        db.prepare(
          "UPDATE runs SET status='running',threadId='test-provider' WHERE id=?",
        ).run(input.messageId);
        putMessage(db, agent.id, {
          id: "assistant",
          role: "assistant",
          text: "First",
        });
      }),
    );
    const revision = (await (await request(`${path}conversation`))!.json())
      .revision;
    await run(
      withAgentStore((db) =>
        putMessage(db, agent.id, {
          id: "assistant",
          role: "assistant",
          text: "Finished",
        }),
      ),
    );
    snapshot = await (await request(
      `${path}conversation?since=${revision}`,
    ))!.json();
    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.entries[0].message.text, "Finished");
    const approvalId = await run(
      createApproval(
        {
          agentId: agent.id,
          runId: input.messageId,
          threadId: "test-provider",
          requestKey: "approval",
        },
        { title: "Publish?", details: "Publish the prepared draft." },
      ),
    );
    assert.equal((await (await request(`${path}approvals`))!.json()).length, 1);
    assert.equal(
      (
        await request(`${path}approvals`, "POST", {
          id: approvalId,
          response: { decision: "approve" },
        })
      )?.status,
      200,
    );
    assert.equal((await (await request(`${path}approvals`))!.json()).length, 0);
    // Resolving existing work remains possible in maintenance, sending does not.
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1").run(),
      ),
    );
    assert.equal(
      (
        await request(`${path}messages`, "POST", {
          messageId: randomUUID(),
          text: "No",
        })
      )?.status,
      400,
    );
    assert.equal(
      (await request(`${path}stop`, "POST", { id: input.messageId }))?.status,
      200,
    );
    assert.equal((await request("session", "DELETE"))?.status, 200);
    assert.equal((await request("agents"))?.status, 401);
    const expired = tokens.create("Expired");
    const db = new DatabaseSync(join(root, "mobile.sqlite"));
    db.prepare("UPDATE devices SET expires=0 WHERE id=?").run(expired.id);
    db.close();
    assert.equal(tokens.authenticate(expired.secret), null);
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("mobile file API authenticates uploads and downloads, bounds bodies, and respects agent ownership", async () => {
  const root = mkdtempSync(join(tmpdir(), "roost-mobile-files-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  const tokens = new MobileTokens(root);
  const handle = createMobileHandler(async () => {});
  try {
    const { secret } = tokens.create("Files");
    const agent = await Effect.runPromise(
      saveAgent({
        id: randomUUID(),
        name: "Moss",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const form = new FormData();
    form.set("agentId", agent.id);
    form.set(
      "file",
      new File(["Hello iPhone"], "hello.txt", { type: "text/plain" }),
    );
    const response = await handle(
      new Request("https://roost.example/api/mobile/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        body: form,
      }),
    );
    assert.equal(response?.status, 200);
    const file = await response!.json();
    const download = (id: string) =>
      handle(
        new Request(
          `https://roost.example/api/mobile/v1/files?agentId=${id}&id=${file.id}`,
          { headers: { Authorization: `Bearer ${secret}` } },
        ),
      );
    assert.equal(await (await download(agent.id))!.text(), "Hello iPhone");
    assert.equal((await download(randomUUID()))?.status, 404);
    const large = await handle(
      new Request(
        `https://roost.example/api/mobile/v1/agents/${agent.id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: "x".repeat(300000) }),
        },
      ),
    );
    assert.equal(large?.status, 400);
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
