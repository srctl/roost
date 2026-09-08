import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { readSoul } from "../src/server/agents/soul.server";
import { saveAgent } from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { sendConversation } from "../src/server/codex/conversation.server";
import {
  getCodingSettings,
  saveCodingSettings,
} from "../src/server/coding/store.server";

test("coding conversations retain soul tools, load edited configuration, and keep reflection restricted", async () => {
  const directory = mkdtempSync("/tmp/roost-coding-conversation-");
  const previous = {
    dir: process.env.ROOST_DATA_DIR,
    home: process.env.CODEX_HOME,
    binary: process.env.ROOST_CODEX_BINARY,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.CODEX_HOME = directory;
  process.env.ROOST_CODEX_BINARY = new URL(
    "./fixtures/chat-server.mjs",
    import.meta.url,
  ).pathname;
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  const run = Effect.runPromise;
  try {
    const coding = await run(
      saveAgent({
        id: randomUUID(),
        name: "Builder",
        instructions: "Collaborate on this project",
        model: "fake",
        character: "moss",
        kind: "coding",
      }),
    );
    const normal = await run(
      saveAgent({
        id: randomUUID(),
        name: "Assistant",
        instructions: "Help",
        model: "fake",
        character: "wisp",
      }),
    );
    const send = (agentId: string, text: string) =>
      run(
        sendConversation({ agentId, messageId: randomUUID(), text }, () => {}),
      );
    const thread = (agentId: string) =>
      JSON.parse(
        readFileSync(
          join(directory, "agents", agentId, "codex", "fake-thread.json"),
          "utf8",
        ),
      );
    await send(coding.id, "Hi");
    const originalSoul = (await run(readSoul(coding.id))).content;
    const options = thread(coding.id).options;
    assert.equal(options.approvalsReviewer, "auto_review");
    assert.equal(options.approvalPolicy, "on-request");
    assert.equal(options.sandbox, "workspace-write");
    assert.ok(
      options.dynamicTools.some(
        (tool: { name: string }) => tool.name === "roost_start_coding_job",
      ),
    );
    assert.ok(
      options.dynamicTools.some(
        (tool: { name: string }) => tool.name === "roost_update_soul",
      ),
    );
    assert.match(options.developerInstructions, /Coding specialization/);
    assert.ok(options.developerInstructions.includes(originalSoul));
    const settings = await run(getCodingSettings(coding.id));
    await run(
      saveCodingSettings({
        ...settings,
        repository: "/work/project",
        projectInstructions: "Always run the integration suite.",
      }),
    );
    await send(coding.id, "Discuss the next task");
    assert.ok(
      thread(coding.id).instructionUpdates.some(
        (item: { content: { text: string }[] }) =>
          item.content[0]!.text.includes("Always run the integration suite."),
      ),
    );
    assert.equal((await run(readSoul(coding.id))).content, originalSoul);
    await send(normal.id, "Hi");
    assert.ok(
      !thread(normal.id).options.dynamicTools.some((tool: { name: string }) =>
        tool.name.startsWith("roost_start_coding"),
      ),
    );
    await run(
      sendConversation(
        { agentId: coding.id, messageId: randomUUID(), text: "Reflect" },
        () => {},
        undefined,
        "reflection",
      ),
    );
    const reflected = thread(coding.id).options;
    assert.equal(reflected.sandbox, "read-only");
    assert.ok(
      reflected.dynamicTools.every((tool: { name: string }) =>
        ["roost_read_soul", "roost_update_soul"].includes(tool.name),
      ),
    );
    assert.ok(
      !reflected.developerInstructions.includes(
        "Always run the integration suite.",
      ),
    );
  } finally {
    await closeAgentRuntimes();
    for (const [key, value] of [
      ["ROOST_DATA_DIR", previous.dir],
      ["CODEX_HOME", previous.home],
      ["ROOST_CODEX_BINARY", previous.binary],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
