import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import {
  isReactionEmoji,
  MAX_REACTIONS_PER_ACTOR,
} from "../src/features/chat/reactions";
import { Message, SetReaction } from "../src/features/chat/schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { setMessageReaction } from "../src/server/runs/reactions.server";
import {
  deleteReplyThread,
  openReplyThread,
} from "../src/server/runs/threads.server";
import {
  putMessage,
  readTimeline,
  readTimelinePage,
} from "../src/server/runs/timeline.server";

const run = Effect.runPromise;

test("reaction emoji validation accepts one Unicode emoji and rejects text and components", () => {
  for (const emoji of [
    "👍",
    "❤️",
    "❤",
    "😂",
    "🎉",
    "🤔",
    "👀",
    "👩🏽‍💻",
    "👨‍👩‍👧‍👦",
    "🏳️‍🌈",
    "🇺🇸",
    "1️⃣",
    "*️⃣",
    "#️⃣",
    "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
  ])
    assert.equal(isReactionEmoji(emoji), true, emoji);
  for (const text of [
    "",
    "yes",
    "1",
    "*",
    "#",
    "US",
    "👍👍",
    " hi 👍",
    "👍 ",
    "👍\n",
    "👩‍💻abc",
    "🏽",
    "🇺",
    "💡🏻",
    "a".repeat(10_000),
    "😀\u0301",
    "😀\u200Dhello",
  ])
    assert.equal(isReactionEmoji(text), false, text);
  assert.throws(() =>
    Schema.decodeUnknownSync(SetReaction)({
      agentId: randomUUID(),
      messageId: "m",
      emoji: "hello",
      active: true,
    }),
  );
  assert.deepEqual(
    Schema.decodeUnknownSync(Message)({
      id: "legacy",
      role: "assistant",
      text: "Hi",
    }),
    {
      id: "legacy",
      role: "assistant",
      text: "Hi",
    },
  );
});

test("reactions persist, isolate actors and publish incremental edits without losing provider updates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-reactions-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Moss",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    await run(
      withAgentStore((db) => {
        putMessage(db, agent.id, {
          id: "reply",
          role: "assistant",
          text: "Original",
        });
      }),
    );
    const thread = await run(openReplyThread(agent.id, "reply"));
    const initial = await run(
      withAgentStore((db) => readTimelinePage(db, agent.id)),
    );
    const input = {
      agentId: agent.id,
      messageId: "reply",
      emoji: "👍",
      active: true,
    };
    const user = await run(setMessageReaction(input, "user", directory));
    assert.deepEqual(user.reactions, [{ emoji: "👍", actor: "user" }]);
    assert.ok(user.createdAt);
    const changed = await run(
      withAgentStore((db) =>
        readTimelinePage(db, agent.id, { since: initial.revision }),
      ),
    );
    assert.deepEqual(
      changed.entries.map((entry) => entry.message.id),
      ["reply"],
    );
    assert.equal(changed.entries[0]!.position, initial.entries[0]!.position);
    assert.equal(
      changed.entries[0]!.message.createdAt,
      initial.entries[0]!.message.createdAt,
    );
    assert.deepEqual(changed.entries[0]!.message.reactions, user.reactions);

    await run(setMessageReaction(input, "user", directory));
    assert.deepEqual(
      await run(
        withAgentStore((db) =>
          readTimelinePage(db, agent.id, { since: changed.revision }),
        ),
      ),
      {
        entries: [],
        revision: changed.revision,
        before: null,
      },
    );
    const both = await run(setMessageReaction(input, "assistant", directory));
    assert.deepEqual(both.reactions, [
      { emoji: "👍", actor: "user" },
      { emoji: "👍", actor: "assistant" },
    ]);
    const removed = await run(
      setMessageReaction({ ...input, active: false }, "user", directory),
    );
    assert.deepEqual(removed.reactions, [{ emoji: "👍", actor: "assistant" }]);

    // A stale in-memory provider event may include old reactions, and ordinary
    // provider history includes none. Neither may overwrite the current state.
    await run(
      withAgentStore((db) => {
        putMessage(db, agent.id, { ...user, text: "Streaming update" });
        putMessage(db, agent.id, {
          id: "reply",
          role: "assistant",
          text: "Provider final",
          nativeThreadId: "native",
        });
      }),
    );
    const persisted = (await run(readTimeline(agent.id)))[0]!;
    assert.equal(persisted.text, "Provider final");
    assert.deepEqual(persisted.reactions, removed.reactions);
    const parent = await run(
      withAgentStore((db) =>
        JSON.parse(
          String(
            db
              .prepare("SELECT parent FROM conversation_records WHERE id=?")
              .get(thread.id)!.parent,
          ),
        ),
      ),
    );
    assert.deepEqual(parent, persisted);

    await run(
      setMessageReaction({ ...input, active: false }, "assistant", directory),
    );
    await run(withAgentStore((db) => putMessage(db, agent.id, both)));
    assert.deepEqual((await run(readTimeline(agent.id)))[0]!.reactions, []);
    const cleared = await run(
      withAgentStore((db) => readTimelinePage(db, agent.id)),
    );
    await run(
      setMessageReaction({ ...input, active: false }, "assistant", directory),
    );
    await run(withAgentStore((db) => putMessage(db, agent.id, both)));
    assert.deepEqual(
      (
        await run(
          withAgentStore((db) =>
            readTimelinePage(db, agent.id, { since: cleared.revision }),
          ),
        )
      ).entries,
      [],
    );
    assert.deepEqual(
      await run(
        withAgentStore(
          (db) =>
            JSON.parse(
              String(
                db
                  .prepare("SELECT parent FROM conversation_records WHERE id=?")
                  .get(thread.id)!.parent,
              ),
            ).reactions,
        ),
      ),
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reaction writes enforce ownership, message roles, active conversations, limits and exact message identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-reaction-scopes-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
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
        name: "Other",
        instructions: "Help",
        character: "wisp",
        model: "fake",
      }),
    );
    await run(
      withAgentStore((db) => {
        for (const role of ["assistant", "user", "notice", "activity"] as const)
          putMessage(db, agent.id, { id: role, role, text: role });
        putMessage(db, other.id, {
          id: "assistant",
          role: "assistant",
          text: "Private",
        });
      }),
    );
    const thread = await run(openReplyThread(agent.id, "assistant"));
    await run(
      withAgentStore((db) =>
        putMessage(
          db,
          agent.id,
          { id: "assistant", role: "assistant", text: "Thread reply" },
          thread.id,
        ),
      ),
    );
    const input = {
      agentId: agent.id,
      messageId: "assistant",
      emoji: "🎉",
      active: true,
    };
    await run(
      setMessageReaction({ ...input, conversationId: thread.id }, "user"),
    );
    assert.equal((await run(readTimeline(agent.id)))[0]!.reactions, undefined);
    assert.equal((await run(readTimeline(other.id)))[0]!.reactions, undefined);
    assert.deepEqual(
      (await run(readTimeline(agent.id, thread.id)))[0]!.reactions,
      [{ emoji: "🎉", actor: "user" }],
    );
    await assert.rejects(
      run(
        setMessageReaction(
          { ...input, agentId: other.id, conversationId: thread.id },
          "user",
        ),
      ),
      /Conversation not found/,
    );
    await assert.rejects(
      run(setMessageReaction({ ...input, messageId: "missing" }, "assistant")),
      /Message not found/,
    );
    await assert.rejects(
      run(setMessageReaction({ ...input, agentId: randomUUID() }, "assistant")),
    );
    await assert.rejects(
      run(setMessageReaction({ ...input, messageId: "user" }, "user")),
      /AI messages/,
    );
    assert.deepEqual(
      (
        await run(
          setMessageReaction({ ...input, messageId: "user" }, "assistant"),
        )
      ).reactions,
      [{ emoji: "🎉", actor: "assistant" }],
    );
    for (const messageId of ["notice", "activity"])
      for (const actor of ["user", "assistant"] as const)
        await assert.rejects(
          run(setMessageReaction({ ...input, messageId }, actor)),
        );
    for (const emoji of ["hello", "👍👍", "", "😀 "])
      await assert.rejects(
        run(setMessageReaction({ ...input, emoji }, "assistant")),
        /single emoji/,
      );
    const emojis = [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "😂",
      "🤣",
      "😊",
      "😇",
      "🙂",
      "🙃",
      "😉",
      "😌",
      "😍",
      "🥰",
      "😘",
      "😗",
      "😙",
      "😚",
    ];
    assert.equal(emojis.length, MAX_REACTIONS_PER_ACTOR);
    for (const emoji of emojis)
      await run(setMessageReaction({ ...input, emoji }, "user"));
    await assert.rejects(run(setMessageReaction(input, "user")), /up to 20/);
    await run(setMessageReaction({ ...input, emoji: emojis[0]! }, "user"));
    await run(setMessageReaction(input, "assistant"));
    await run(
      setMessageReaction(
        { ...input, emoji: emojis[0]!, active: false },
        "user",
      ),
    );
    await run(setMessageReaction(input, "user"));
    await run(deleteReplyThread(agent.id, thread.id));
    await assert.rejects(
      run(
        setMessageReaction(
          { ...input, conversationId: thread.id },
          "assistant",
        ),
      ),
      /Conversation not found/,
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
