import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  getAgentConversation,
  saveAgent,
  withAgentStore,
} from "../src/server/agents/store.server";
import {
  listAutomations,
  saveAutomation,
} from "../src/server/automations/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import {
  agentTools,
  handleAgentTool,
} from "../src/server/codex/agent-tools.server";
import { sendConversation } from "../src/server/codex/conversation.server";
import {
  listRuns,
  runAutomationNow,
  schedulerTick,
} from "../src/server/runs/store.server";

const run = Effect.runPromise;
test("automation models migrate, persist, validate, snapshot, and isolate execution", async () => {
  mkdirSync(join(process.cwd(), ".roost"), { recursive: true });
  const directory = mkdtempSync(
    join(process.cwd(), ".roost/automation-model-test-"),
  );
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
        model: "fake",
      }),
    );
    const input = {
      agentId: agent.id,
      id: randomUUID(),
      name: "Status",
      prompt: "Hi",
      schedule: { kind: "interval" as const, minutes: 60, timezone: "UTC" },
      notification: "always" as const,
    };
    await run(saveAutomation(input));
    // Recreate the previous schema with an existing saved automation.
    const db = new DatabaseSync(join(directory, "roost.sqlite"));
    db.exec(
      "ALTER TABLE automations DROP COLUMN model; PRAGMA user_version=8;",
    );
    db.close();
    let saved = (await run(listAutomations(agent.id)))[0]!;
    assert.equal(saved.model, null);
    assert.equal(saved.name, "Status");
    await assert.rejects(
      run(saveAutomation({ ...saved, model: "unknown-model" }, saved.revision)),
      /unavailable/,
    );
    await assert.rejects(
      run(saveAutomation({ ...saved, model: " " }, saved.revision)),
    );
    saved = await run(
      saveAutomation({ ...saved, model: "gpt-5.6-luna" }, saved.revision),
    );
    assert.equal(
      (await run(listAutomations(agent.id)))[0]?.model,
      "gpt-5.6-luna",
    );
    assert.equal(
      (await run(saveAutomation({ ...input, model: "gpt-5.6-luna" }))).revision,
      saved.revision,
    );
    await assert.rejects(
      run(saveAutomation({ ...input, model: "gpt-6-astra" })),
      /already exists/,
    );
    await assert.rejects(
      run(saveAutomation({ ...saved, model: null }, saved.revision - 1)),
      /changed/,
    );
    saved = await run(
      saveAutomation({ ...input, name: "Renamed" }, saved.revision),
    );
    assert.equal(
      saved.model,
      "gpt-5.6-luna",
      "older edit callers preserve model",
    );
    await run(
      withAgentStore((store) =>
        store
          .prepare("UPDATE automations SET nextRunAt=? WHERE id=?")
          .run(Date.now() - 1000, saved.id),
      ),
    );
    await run(schedulerTick("model-test"));
    await run(runAutomationNow(agent.id, saved.id, randomUUID()));
    const queued = await run(listRuns(agent.id));
    assert.equal(queued.length, 2);
    assert.ok(queued.some((entry) => entry.scheduledFor !== null));
    const context = await run(getAgentConversation(agent.id));
    const thread = () =>
      JSON.parse(
        readFileSync(join(context.codexHome, "fake-thread.json"), "utf8"),
      );
    for (const entry of queued) {
      const snapshot = JSON.parse(entry.automationSnapshot!);
      assert.equal(snapshot.model, "gpt-5.6-luna");
      await run(
        sendConversation(
          { agentId: agent.id, messageId: entry.id, text: "Hi" },
          () => {},
          snapshot,
        ),
      );
      const options = thread().options;
      assert.equal(options.model, "gpt-5.6-luna");
      assert.equal(options.cwd, context.workspace);
      assert.equal(options.approvalPolicy, "on-request");
      assert.equal(options.approvalsReviewer, "auto_review");
      assert.match(options.developerInstructions, /You are Scout/);
      assert.match(options.developerInstructions, /do not change your soul/);
    }
    assert.equal((await run(getAgentConversation(agent.id))).threadId, null);
    saved = await run(
      saveAutomation({ ...saved, model: "gpt-6-astra" }, saved.revision),
    );
    assert.ok(
      (await run(listRuns(agent.id))).every(
        (entry) => entry.status === "cancelled",
      ),
    );
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
        () => {},
        saved,
      ),
    );
    assert.equal(thread().options.model, "gpt-6-astra");
    writeFileSync(join(context.codexHome, "fake-no-models"), "");
    await assert.rejects(
      run(
        sendConversation(
          { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
          () => {},
          saved,
        ),
      ),
      /unavailable.*Edit the automation/,
    );
    saved = await run(
      saveAutomation({ ...saved, model: null }, saved.revision),
    );
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
        () => {},
        saved,
      ),
    );
    assert.equal(thread().options.model, "fake");
    await run(
      sendConversation(
        { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
        () => {},
      ),
    );
    assert.equal(thread().options.model, "fake");
    assert.ok((await run(getAgentConversation(agent.id))).threadId);
    // Either feature preview used tool version 11; base threads used 10.
    // Both must get a fresh native thread with the combined tool inventory.
    for (const version of [10, 11]) {
      const old = await run(getAgentConversation(agent.id));
      await run(
        withAgentStore((store) =>
          store
            .prepare(
              "UPDATE agent_tool_versions SET version=? WHERE threadId=?",
            )
            .run(version, old.threadId!),
        ),
      );
      await run(
        sendConversation(
          { agentId: agent.id, messageId: randomUUID(), text: "Hi" },
          () => {},
        ),
      );
      const migrated = await run(getAgentConversation(agent.id));
      assert.notEqual(migrated.threadId, old.threadId);
      assert.equal(migrated.toolVersion, 13);
      assert.equal(migrated.codexHome, old.codexHome);
      assert.equal(migrated.workspace, old.workspace);
      assert.ok(
        JSON.parse(migrated.archive).length > JSON.parse(old.archive).length,
      );
      const names = thread().options.dynamicTools.map(
        (tool: { name: string }) => tool.name,
      );
      for (const name of [
        "roost_list_models",
        "roost_save_automation",
        "roost_list_datasets",
        "roost_save_dataset",
        "roost_delete_dataset",
      ])
        assert.ok(names.includes(name), name);
    }
    const toolContext = { agentId: agent.id, allowMutations: true };
    const catalog = await handleAgentTool(toolContext, "roost_list_models", {});
    assert.equal(catalog.success, true);
    assert.match(JSON.stringify(catalog), /gpt-5.6-luna/);
    assert.match(
      JSON.stringify(
        agentTools.find((tool) => tool.name === "roost_save_automation")
          ?.inputSchema,
      ),
      /model/,
    );
    const denied = await handleAgentTool(
      { ...toolContext, allowMutations: false },
      "roost_save_automation",
      { ...saved, model: "gpt-5.6-luna", expectedRevision: saved.revision },
    );
    assert.equal(denied.success, false);
    const updated = await handleAgentTool(
      toolContext,
      "roost_save_automation",
      {
        ...saved,
        model: "gpt-5.6-luna",
        expectedRevision: saved.revision,
      },
    );
    assert.equal(updated.success, true);
    assert.equal(
      (await run(listAutomations(agent.id)))[0]?.model,
      "gpt-5.6-luna",
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
