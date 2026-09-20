import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { ChatEvent, Message } from "../src/features/chat/schema";
import {
  getAgentConversation,
  saveAgent,
  saveConversationThread,
} from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import {
  readConversation,
  sendConversation,
} from "../src/server/codex/conversation.server";

test("completion preserves archived and current items sharing native IDs across threads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-completion-identity-"));
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    ROOST_CODEX_BINARY: process.env.ROOST_CODEX_BINARY,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.CODEX_HOME = directory;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  const run = Effect.runPromise;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Completion identity",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "First reply" },
        () => {},
      ),
    );
    const { threadId } = await run(getAgentConversation(agent.id));
    assert.ok(threadId);
    // Native IDs are only unique within a provider thread. Archive two older
    // sessions with IDs that the active fixture will also emit on its next turn.
    const replyId = `${threadId}-reply-1`;
    const archive: Message[] = ["old-one", "old-two"].flatMap(
      (nativeThreadId) => [
        {
          id: replyId,
          nativeThreadId,
          role: "assistant" as const,
          text: `${nativeThreadId} reply`,
        },
        {
          id: "cmd",
          nativeThreadId,
          role: "activity" as const,
          title: "Command",
          status: "completed",
          text: `${nativeThreadId} command`,
        },
      ],
    );
    await run(
      saveConversationThread(agent.id, threadId, JSON.stringify(archive)),
    );
    const events: ChatEvent[] = [];
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "activity" },
        (event) => events.push(event),
      ),
    );
    const histories = events.filter((event) => event.type === "history");
    const final = histories.at(-1)!.messages;
    assert.equal(final.length, 9);
    assert.deepEqual(final.slice(0, archive.length), archive);
    assert.deepEqual(
      final
        .filter((message) => message.id === replyId)
        .map((message) => message.text),
      ["old-one reply", "old-two reply", "Hello there."],
    );
    assert.deepEqual(
      final
        .filter((message) => message.id === "cmd")
        .map((message) => message.text),
      ["old-one command", "old-two command", "hello"],
    );
    assert.equal(
      new Set(
        final.map((message) =>
          JSON.stringify([message.nativeThreadId ?? null, message.id]),
        ),
      ).size,
      final.length,
    );
    assert.deepEqual(events.at(-1), { type: "done", status: "completed" });
  } finally {
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("steering into a new turn preserves late previous-turn output without ending the new turn", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-completion-steering-"));
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    ROOST_CODEX_BINARY: process.env.ROOST_CODEX_BINARY,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.CODEX_HOME = directory;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  const run = Effect.runPromise;
  try {
    for (const followUpText of [
      "complete-racing-turn",
      "complete-racing-turn-failed",
    ]) {
      const agent = await run(
        saveAgent({
          id: randomUUID(),
          name: "Steering completion",
          instructions: "Help",
          character: "moss",
          model: "fake",
        }),
      );
      let steered = false;
      const events: ChatEvent[] = [];
      await run(
        sendConversation(
          {
            agentId: agent.id,
            messageId: randomUUID(),
            text: "steer-completion-race",
          },
          (event) => events.push(event),
          undefined,
          "chat",
          Effect.sync(() => {
            if (steered) return;
            steered = true;
            return {
              agentId: agent.id,
              messageId: randomUUID(),
              text: followUpText,
            };
          }),
        ),
      );
      const final = events.filter((event) => event.type === "history").at(-1)!;
      assert.deepEqual(
        final.messages.map((message) => message.text),
        [
          "steer-completion-race",
          "Final old reply",
          "old command output",
          followUpText,
          "New reply completed",
        ],
      );
      assert.equal(
        final.messages.find((message) => message.id === "race-old-command")
          ?.status,
        "completed",
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === "activityDelta" &&
            event.id === "race-old-command" &&
            event.text === "old command output",
        ),
      );
      assert.ok(
        events.some(
          (event) =>
            event.type === "message" &&
            event.message.id === "race-old-reply" &&
            event.message.text === "Final old reply",
        ),
      );
      assert.deepEqual(
        events.filter((event) => event.type === "done"),
        [{ type: "done", status: "completed" }],
      );
      assert.equal(
        events.some((event) => event.type === "error"),
        false,
      );
      // A fallback whole-history read cannot hide lost late notifications.
      await assert.rejects(run(readConversation(agent.id)), /Codex rejected/);
    }
  } finally {
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
