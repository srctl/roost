import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { readSoul } from "../src/server/agents/soul.server";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  readConversation,
  sendConversation,
} from "../src/server/codex/conversation.server";
import type { ChatEvent } from "../src/features/chat/schema";

test("chat lifecycle preserves history, isolates agents, migrates legacy sessions, and scopes soul tools", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-chat-test-"));
  const previousDir = process.env.ROOST_DATA_DIR;
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = directory;
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  const previousBinary = process.env.ROOST_CODEX_BINARY;
  process.env.ROOST_DATA_DIR = directory;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  try {
    const agent = await Effect.runPromise(
      saveAgent({
        id: randomUUID(),
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    assert.deepEqual(
      (await Effect.runPromise(readConversation(agent.id))).messages,
      [],
    );
    const input = { agentId: agent.id, messageId: randomUUID(), text: "Hi" };
    const events: ChatEvent[] = [];
    await Effect.runPromise(
      sendConversation(input, (event) => events.push(event)),
    );
    assert.equal(events.filter((event) => event.type === "delta").length, 2);
    assert.equal(events.at(-1)?.type, "done");
    const lastHistory = events
      .filter((event) => event.type === "history")
      .at(-1);
    assert.deepEqual(
      lastHistory?.messages.map((message) => message.text),
      ["Hi", "Hello there."],
    );
    const saved = await Effect.runPromise(readConversation(agent.id));
    assert.deepEqual(
      saved.messages.map((message) => message.text),
      ["Hi", "Hello there."],
    );
    await Effect.runPromise(sendConversation(input, () => {}));
    assert.deepEqual(
      (await Effect.runPromise(readConversation(agent.id))).messages,
      saved.messages,
    );
    const abort = new AbortController();
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const sending = Effect.runPromise(
      sendConversation(
        { ...input, messageId: randomUUID(), text: "slow" },
        () => ready(),
      ),
      { signal: abort.signal },
    );
    const rejected = assert.rejects(sending);
    await started;
    await assert.rejects(
      Effect.runPromise(
        sendConversation(
          { ...input, messageId: randomUUID(), text: "Overlap" },
          () => {},
        ),
      ),
      /already replying/,
    );
    abort.abort();
    await rejected;
    await Effect.runPromise(
      sendConversation(
        { ...input, messageId: randomUUID(), text: "Again" },
        () => {},
      ),
    );
    assert.equal(
      (await Effect.runPromise(readConversation(agent.id))).messages.length,
      4,
    );
    // Simulate a conversation created before instruction version tracking.
    await Effect.runPromise(
      withAgentStore((db) => db.exec("DELETE FROM conversation_instructions")),
    );
    const activityEvents: ChatEvent[] = [];
    await Effect.runPromise(
      sendConversation(
        { ...input, messageId: randomUUID(), text: "activity" },
        (event) => activityEvents.push(event),
      ),
    );
    assert.ok(
      activityEvents.some(
        (event) => event.type === "activityDelta" && event.text === "hello",
      ),
    );
    assert.ok(
      activityEvents.some(
        (event) =>
          event.type === "message" && event.message.status === "inProgress",
      ),
    );
    const updates = JSON.parse(
      readFileSync(
        join(directory, "agents", agent.id, "codex", "fake-thread.json"),
        "utf8",
      ),
    ).instructionUpdates;
    assert.equal(updates.length, 1);
    assert.equal(updates[0].role, "developer");
    assert.match(
      updates[0].content[0].text,
      /replace earlier Roost capability instructions/,
    );
    await Effect.runPromise(
      sendConversation(
        { ...input, messageId: randomUUID(), text: "One more" },
        () => {},
      ),
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          join(directory, "agents", agent.id, "codex", "fake-thread.json"),
          "utf8",
        ),
      ).instructionUpdates.length,
      1,
    );
    const restored = await Effect.runPromise(readConversation(agent.id));
    assert.equal(
      restored.messages.find((message) => message.id === "cmd")?.text,
      "hello",
    );
    await Effect.runPromise(
      sendConversation(
        { ...input, messageId: randomUUID(), text: "soul" },
        () => {},
      ),
    );
    assert.match(
      (await Effect.runPromise(readSoul(agent.id))).content,
      /Keep answers concise/,
    );
    const localThread = JSON.parse(
      readFileSync(
        join(directory, "agents", agent.id, "codex", "fake-thread.json"),
        "utf8",
      ),
    );
    assert.deepEqual(localThread.toolChecks, {
      updated: true,
      foreignRejected: true,
    });
    assert.equal(
      localThread.environment.home,
      join(directory, "agents", agent.id, "codex"),
    );
    assert.equal(
      localThread.environment.sqliteHome,
      localThread.environment.home,
    );
    assert.ok(
      localThread.environment.args.includes("memories.use_memories=true"),
    );
    assert.ok(
      localThread.environment.args.includes("memories.generate_memories=true"),
    );
    assert.ok(
      !localThread.environment.args.some((arg: string) =>
        arg.startsWith("features.apps="),
      ),
      "an omitted apps setting must preserve the native Codex default",
    );
    assert.ok(
      localThread.options.dynamicTools.some(
        (tool: { name: string }) => tool.name === "roost_update_soul",
      ),
    );
    writeFileSync(
      join(directory, "fake-config.json"),
      JSON.stringify({ features: { apps: false }, apps: {} }),
    );
    const other = await Effect.runPromise(
      saveAgent({
        id: randomUUID(),
        name: "Other",
        instructions: "Help other",
        character: "wisp",
        model: "fake",
      }),
    );
    await Effect.runPromise(
      sendConversation(
        { agentId: other.id, messageId: randomUUID(), text: "Separate" },
        () => {},
      ),
    );
    const otherThread = JSON.parse(
      readFileSync(
        join(directory, "agents", other.id, "codex", "fake-thread.json"),
        "utf8",
      ),
    );
    assert.ok(otherThread.environment.args.includes("features.apps=false"));
    assert.deepEqual(
      (await Effect.runPromise(readConversation(other.id))).messages.map(
        (m) => m.text,
      ),
      ["Separate", "Hello there."],
    );
    assert.doesNotMatch(
      (await Effect.runPromise(readSoul(other.id))).content,
      /Keep answers concise/,
    );

    writeFileSync(
      join(directory, "fake-config.json"),
      JSON.stringify({ features: { apps: true }, apps: {} }),
    );
    const legacy = await Effect.runPromise(
      saveAgent({
        id: randomUUID(),
        name: "Legacy",
        instructions: "Help legacy",
        character: "peach",
        model: "fake",
      }),
    );
    const legacyThread = {
      id: "legacy-thread",
      developerInstructions: "HOST_PRIVATE_INSTRUCTIONS",
      turns: [
        {
          id: "legacy-turn",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "legacy-user",
              content: [{ type: "text", text: "Remember our conversation" }],
            },
            {
              type: "agentMessage",
              id: "legacy-answer",
              text: "Visible answer",
            },
            {
              type: "reasoning",
              id: "legacy-reasoning",
              summary: ["OLD_REASONING"],
            },
            {
              type: "mcpToolCall",
              id: "legacy-tool",
              tool: "example",
              result: "OLD_TOOL_OUTPUT",
            },
          ],
        },
      ],
    };
    const legacyFile = JSON.stringify(legacyThread);
    writeFileSync(join(directory, "fake-thread.json"), legacyFile);
    await Effect.runPromise(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO conversations (agentId, threadId) VALUES (?, ?)",
          )
          .run(legacy.id, legacyThread.id),
      ),
    );
    assert.equal(
      (await Effect.runPromise(readConversation(legacy.id))).messages[1]?.text,
      "Visible answer",
    );
    await Effect.runPromise(
      sendConversation(
        { agentId: legacy.id, messageId: randomUUID(), text: "Continue" },
        () => {},
      ),
    );
    const migratedFile = readFileSync(
      join(directory, "agents", legacy.id, "codex", "fake-thread.json"),
      "utf8",
    );
    assert.match(migratedFile, /Remember our conversation/);
    assert.ok(
      JSON.parse(migratedFile).environment.args.includes("features.apps=true"),
    );
    assert.doesNotMatch(
      migratedFile,
      /HOST_PRIVATE_INSTRUCTIONS|OLD_REASONING|OLD_TOOL_OUTPUT/,
    );
    assert.equal(
      readFileSync(join(directory, "fake-thread.json"), "utf8"),
      legacyFile,
    );
    assert.deepEqual(
      (await Effect.runPromise(readConversation(legacy.id))).messages
        .filter((m) => m.role !== "activity")
        .map((m) => m.text),
      [
        "Remember our conversation",
        "Visible answer",
        "Continue",
        "Hello there.",
      ],
    );
  } finally {
    await closeAgentRuntimes();
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    if (previousDir === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previousDir;
    if (previousBinary === undefined) delete process.env.ROOST_CODEX_BINARY;
    else process.env.ROOST_CODEX_BINARY = previousBinary;
    rmSync(directory, { recursive: true, force: true });
  }
});
