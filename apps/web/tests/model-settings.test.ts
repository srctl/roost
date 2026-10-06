import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { saveAgentModel } from "../src/server/agents/model.server";
import {
  getAgentConversation,
  saveAgent,
  saveConversationThread,
  withAgentStore,
} from "../src/server/agents/store.server";
import {
  listAutomations,
  saveAutomation,
} from "../src/server/automations/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { sendConversation } from "../src/server/codex/conversation.server";

const run = Effect.runPromise;
test("model settings preserve histories, fence active/stale writes, and route explicit effort across run kinds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-model-settings-"));
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
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Scout",
        instructions: "Help",
        character: "moss",
        model: "gpt-6-astra",
        reasoningEffort: "high",
      }),
    );
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
        () => {},
      ),
    );
    const before = await run(getAgentConversation(agent.id));
    const sibling = randomUUID();
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO conversation_records(id,agentId,createdAt) VALUES(?,?,0)",
          )
          .run(sibling, agent.id),
      ),
    );
    await run(saveConversationThread(agent.id, randomUUID(), "[]", sibling));
    const settings = {
      agentId: agent.id,
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      expectedModel: "gpt-6-astra",
      expectedReasoningEffort: "high",
    };
    const changed = await run(saveAgentModel(settings));
    assert.equal(changed.model, "gpt-6.1-sol");
    assert.equal(changed.reasoningEffort, "low");
    const after = await run(getAgentConversation(agent.id));
    assert.equal(after.threadId, before.threadId);
    assert.equal(after.archive, before.archive);
    assert.equal(
      (await run(getAgentConversation(agent.id, sibling))).sessionModel,
      "gpt-6.1-sol",
    );
    await assert.rejects(run(saveAgentModel(settings)), /settings changed/);
    const current = {
      ...settings,
      expectedModel: "gpt-6.1-sol",
      expectedReasoningEffort: "low",
    };
    await assert.rejects(
      run(saveAgentModel({ ...current, model: "unavailable" })),
      /model is unavailable/,
    );
    await assert.rejects(
      run(saveAgentModel({ ...current, reasoningEffort: "none" })),
      /effort is unavailable/,
    );
    const active = randomUUID();
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES(?,?,'chat','','running',0)",
          )
          .run(active, agent.id),
      ),
    );
    await assert.rejects(run(saveAgentModel(current)), /agent is working/);
    await run(
      withAgentStore((db) =>
        db.prepare("DELETE FROM runs WHERE id=?").run(active),
      ),
    );
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
        () => {},
      ),
    );
    const thread = () =>
      JSON.parse(
        readFileSync(join(after.codexHome, "fake-thread.json"), "utf8"),
      );
    assert.equal(thread().resumeOptions.model, "gpt-6.1-sol");
    assert.equal(thread().resumeOptions.config.model_reasoning_effort, "low");
    assert.equal(thread().lastTurnOptions.effort, "low");
    const automation = await run(
      saveAutomation({
        agentId: agent.id,
        id: randomUUID(),
        name: "Status",
        prompt: "Hi",
        model: "gpt-6-astra",
        reasoningEffort: "high",
        schedule: { kind: "interval", minutes: 60 },
        notification: "always",
      }),
    );
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
        () => {},
        automation,
      ),
    );
    assert.equal(thread().options.model, "gpt-6-astra");
    assert.equal(thread().lastTurnOptions.effort, "high");
    const { reasoningEffort: _effort, ...oldClient } = automation;
    await run(
      saveAutomation({ ...oldClient, name: "Renamed" }, automation.revision),
    );
    assert.equal(
      (await run(listAutomations(agent.id)))[0]?.reasoningEffort,
      "high",
    );
    // Clearing an override must validate preserved effort against the agent model.
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE automations SET reasoningEffort='max' WHERE id=?")
          .run(automation.id),
      ),
    );
    const legacyAutomation = (await run(listAutomations(agent.id)))[0]!;
    await assert.rejects(
      run(
        saveAutomation(
          { ...legacyAutomation, model: null },
          legacyAutomation.revision,
        ),
      ),
      /effort is unavailable/,
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE automations SET reasoningEffort='high' WHERE id=?")
          .run(automation.id),
      ),
    );
    // A stale main-chat model must not control isolated background runs.
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE conversation_sessions SET model='gpt-6-astra' WHERE conversationId=?",
          )
          .run(agent.id),
      ),
    );
    for (const kind of [
      "delegation",
      "reflection",
      "automation",
      "handoff",
    ] as const) {
      const inherited =
        kind === "automation"
          ? {
              ...automation,
              id: "7e9b3bf2-640d-427c-9d6e-e31f5fb614ef",
              model: null,
              reasoningEffort: null,
            }
          : undefined;
      await run(
        sendConversation(
          { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
          () => {},
          inherited,
          kind,
        ),
      );
      assert.equal(thread().options.model, "gpt-6.1-sol", kind);
      assert.equal(thread().lastTurnOptions.effort, "low", kind);
      if (kind !== "delegation")
        assert.equal(thread().options.sandbox, "read-only");
    }
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
        () => {},
      ),
    );
    assert.equal(
      thread().resumeOptions.model,
      "gpt-6-astra",
      "chat retains its saved conversation selection until explicitly changed",
    );
    assert.equal(
      thread().lastTurnOptions.effort,
      "medium",
      "different saved model uses its own catalog default",
    );
  } finally {
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
