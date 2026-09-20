import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { putFeedItem } from "../src/server/feed/store.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

test("feed mobile API authenticates, validates actions, and retries a discussion without duplicate runs", async () => {
  const root = mkdtempSync("/tmp/roost-feed-mobile-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  const tokens = new MobileTokens(root);
  const device = tokens.create("Feed test phone");
  const handle = createMobileHandler(async () => {});
  const run = Effect.runPromise;
  const request = (path: string, data?: unknown) =>
    handle(
      new Request(`https://roost.example/api/mobile/v1/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${device.secret}`,
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
    );
  try {
    assert.equal(
      (await handle(new Request("https://roost.example/api/mobile/v1/feed")))
        ?.status,
      401,
    );
    const editor = await run(
      saveAgent({
        id: randomUUID(),
        name: "Editor",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const id = randomUUID();
    await run(
      withAgentStore((db) =>
        putFeedItem(
          db,
          {
            id,
            kind: "article",
            title: "A useful local update",
            summary: "An attributed excerpt",
            body: "An attributed excerpt",
            url: "https://news.example.com/story",
            imageUrl: null,
            sourceName: "Local News",
            sourceUrl: null,
            authorAgentId: null,
            publishedAt: Date.now(),
            createdAt: Date.now(),
            readAt: null,
            saved: false,
            dismissed: false,
            topics: ["Seattle"],
            why: "A source you follow",
            importance: "normal",
            score: 0.7,
            scoring: "basic",
            citations: [
              { title: "Original", url: "https://news.example.com/story" },
            ],
          },
          "mobile-test",
        ),
      ),
    );
    const response = (await request("feed"))!;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const page = await response.json();
    assert.equal(page.items[0].id, id);
    assert.equal((await request("feed?filter=invalid"))?.status, 400);
    assert.equal(
      (await request(`feed/items/${id}`, { action: "invalid" }))?.status,
      400,
    );
    assert.equal(
      (await request(`feed/items/${id}`, { action: "save" }))?.status,
      200,
    );
    assert.equal(
      (await (await request("feed?filter=saved"))!.json()).items[0].id,
      id,
    );
    await request(`feed/items/${id}`, { action: "read" });
    assert.equal(
      (await (await request("feed?filter=unread"))!.json()).items.length,
      0,
    );
    await request(`feed/items/${id}`, { action: "dismiss" });
    assert.equal((await (await request("feed"))!.json()).items.length, 0);
    await request(`feed/items/${id}`, { action: "restore" });
    const input = { requestId: randomUUID(), agentId: editor.id };
    const first = (await request(`feed/items/${id}/discuss`, input))!;
    assert.equal(first.status, 200);
    const thread = await first.json();
    assert.deepEqual(
      await (await request(`feed/items/${id}/discuss`, input))!.json(),
      thread,
    );
    assert.notEqual(thread.conversationId, editor.id);
    assert.equal(
      await run(
        withAgentStore((db) =>
          Number(
            db
              .prepare("SELECT COUNT(*) n FROM runs WHERE id=?")
              .get(input.requestId)!.n,
          ),
        ),
      ),
      1,
    );
    assert.equal((await request("feed/refresh", {}))?.status, 400);
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
