import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  agentTools,
  handleAgentTool,
} from "../src/server/codex/agent-tools.server";
import { readReactionContext } from "../src/server/runs/reaction-tools.server";
import { setMessageReaction } from "../src/server/runs/reactions.server";
import {
  openReplyThread,
  readSharedContext,
} from "../src/server/runs/threads.server";
import { putMessage, readTimeline } from "../src/server/runs/timeline.server";

const run = Effect.runPromise;

test("agent reaction tool is scoped to its active run and preserves user feedback", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-reaction-tools-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agentId = randomUUID();
    const otherId = randomUUID();
    for (const id of [agentId, otherId])
      await run(
        saveAgent({
          id,
          name: "Moss",
          instructions: "Help",
          character: "moss",
          model: "fake",
        }),
      );
    await run(
      withAgentStore((db) => {
        for (const id of [agentId, otherId])
          putMessage(db, id, {
            id: "reply",
            role: "assistant",
            text: "A response",
          });
      }),
    );
    const child = await run(openReplyThread(agentId, "reply"));
    const otherChild = await run(openReplyThread(otherId, "reply"));
    const runId = randomUUID();
    await run(
      withAgentStore((db) => {
        db.prepare(
          "INSERT INTO runs(id,agentId,conversationId,kind,prompt,status,createdAt) VALUES (?,?,?,'chat','Hello','running',?)",
        ).run(runId, agentId, child.id, Date.now());
        putMessage(
          db,
          agentId,
          { id: "user", role: "user", text: "Thanks!" },
          child.id,
        );
      }),
    );
    const context = { agentId, runId, allowMutations: true };
    const tool = (args: unknown, ctx = context) =>
      handleAgentTool(ctx, "roost_react_to_message", args);
    assert.ok(
      agentTools.some((entry) => entry.name === "roost_react_to_message"),
    );
    assert.equal(
      (await tool({ messageId: "user", emoji: "🎉", active: true })).success,
      true,
    );
    assert.deepEqual(
      (await run(readTimeline(agentId, child.id)))[0].reactions,
      [{ emoji: "🎉", actor: "assistant" }],
    );
    assert.equal(
      (
        await tool({
          messageId: "reply",
          conversationId: otherChild.id,
          emoji: "👍",
          active: true,
        })
      ).success,
      false,
    );
    assert.equal(
      (await tool({ messageId: "user", emoji: "not an emoji", active: true }))
        .success,
      false,
    );
    assert.equal(
      (
        await tool(
          { messageId: "user", emoji: "👍", active: true },
          { ...context, agentId: otherId },
        )
      ).success,
      false,
    );
    const reflection = await handleAgentTool(
      { ...context, allowMutations: "reflection" },
      "roost_react_to_message",
      { messageId: "user", emoji: "👍", active: true },
    );
    assert.equal(reflection.success, false);
    await run(
      setMessageReaction(
        { agentId, messageId: "reply", emoji: "❤️", active: true },
        "user",
      ),
    );
    assert.equal(
      (
        await tool({
          conversationId: agentId,
          messageId: "reply",
          emoji: "❤️",
          active: true,
        })
      ).success,
      true,
    );
    assert.equal(
      (
        await tool({
          conversationId: agentId,
          messageId: "reply",
          emoji: "❤️",
          active: false,
        })
      ).success,
      true,
    );
    assert.deepEqual((await run(readTimeline(agentId)))[0].reactions, [
      { emoji: "❤️", actor: "user" },
    ]);
    const shared = await run(
      readSharedContext(agentId, { conversationId: agentId }),
    );
    assert.deepEqual(shared.entries[0].reactions, [
      { emoji: "❤️", actor: "user" },
    ]);
    assert.deepEqual(
      (await run(readTimeline(otherId)))[0].reactions,
      undefined,
    );
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET cancelRequested=1 WHERE id=?").run(runId),
      ),
    );
    assert.equal(
      (await tool({ messageId: "user", emoji: "🎉", active: false })).success,
      false,
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE runs SET cancelRequested=0,status='completed' WHERE id=?",
          )
          .run(runId),
      ),
    );
    assert.equal(
      (await tool({ messageId: "user", emoji: "🎉", active: false })).success,
      false,
    );
    const missing = await handleAgentTool(
      { agentId, allowMutations: true },
      "roost_react_to_message",
      { messageId: "reply", emoji: "👍", active: true },
    );
    assert.equal(missing.success, false);
    await run(
      withAgentStore((db) => {
        for (let index = 0; index < 15; index++)
          putMessage(db, agentId, {
            id: `bounded-${index}`,
            role: "assistant",
            text: "a".repeat(1000),
          });
      }),
    );
    const snapshot = await run(readReactionContext(agentId));
    assert.equal(snapshot.length, 12);
    assert.equal(snapshot[0].messageId, "bounded-3");
    assert.ok(snapshot.every((entry) => entry.text.length <= 500));
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
