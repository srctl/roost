import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import {
  agentTools,
  handleAgentTool,
} from "../src/server/codex/agent-tools.server";
import { sendConversation } from "../src/server/codex/conversation.server";
import {
  FEED_EDITOR_AUTOMATION_ID,
  runCapabilities,
} from "../src/server/codex/run-capabilities.server";
import { computerAction } from "../src/server/computer/tools.server";
import { PaymentStore } from "../src/server/payments/store.server";
import { handlePaymentTool } from "../src/server/payments/tools.server";
import { insertRun } from "../src/server/runs/store.server";

// The fake model deliberately calls tools absent from its catalog. The server
// must reject those calls before argument decoding or invoking any backend.
test("handoff and Feed runs reject forged tools through app-server dispatch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-capabilities-"));
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    ROOST_CODEX_BINARY: process.env.ROOST_CODEX_BINARY,
    ROOST_CODEX_SANDBOX: process.env.ROOST_CODEX_SANDBOX,
  };
  process.env.ROOST_DATA_DIR = directory;
  process.env.CODEX_HOME = directory;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/chat-server.mjs", import.meta.url),
  );
  // Restricted runs must remain restricted even on an operator's dedicated VM.
  process.env.ROOST_CODEX_SANDBOX = "danger-full-access";
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  const forbidden = [
    "roost_computer",
    "roost_request_approval",
    "roost_publish_artifact",
    "roost_request_purchase",
    "roost_fill_payment",
    "roost_notify",
    "roost_save_dataset",
    "roost_save_dashboard",
    "roost_create_weather_tracker",
    "roost_delegate_task",
    "roost_start_coding_job",
    "roost_save_automation",
    "roost_patch_note",
    "unknown_future_tool",
  ];
  try {
    const agent = await Effect.runPromise(
      saveAgent({
        id: randomUUID(),
        name: "Capabilities",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    for (const kind of ["handoff", "automation"] as const) {
      const runId = randomUUID();
      await Effect.runPromise(
        withAgentStore((db) => {
          insertRun(db, {
            id: runId,
            agentId: agent.id,
            prompt: "Untrusted report",
          });
          db.prepare(
            "UPDATE runs SET kind=?,automationId=?,status='running' WHERE id=?",
          ).run(
            kind,
            kind === "automation" ? FEED_EDITOR_AUTOMATION_ID : null,
            runId,
          );
        }),
      );
      let paymentReached = false;
      const store = new PaymentStore();
      store.read = () => {
        paymentReached = true;
        throw new Error("Forbidden payment backend reached");
      };
      const payment = await handlePaymentTool(
        { agentId: agent.id, runId, signal: new AbortController().signal },
        "roost_payment_status",
        {},
        store,
      );
      assert.equal(payment.success, false);
      assert.equal(paymentReached, false);
      const computer = await Effect.runPromise(
        computerAction(agent.id, { action: "screenshot" }, runId),
      );
      assert.equal(computer.success, false);
      assert.match(JSON.stringify(computer), /cannot use the computer/);
      const generic = await handleAgentTool(
        { agentId: agent.id, runId, allowMutations: true },
        "roost_save_dataset",
        {},
      );
      assert.equal(generic.success, false);
      assert.match(JSON.stringify(generic), /cannot use that tool/);
      await Effect.runPromise(
        withAgentStore((db) =>
          db
            .prepare("UPDATE runs SET status='completed' WHERE id=?")
            .run(runId),
        ),
      );
    }
    const input = (tools: string[]) => ({
      agentId: agent.id,
      messageId: randomUUID(),
      text: `capability-probe:${JSON.stringify(tools)}`,
    });
    const home = join(directory, "agents", agent.id, "codex");
    const thread = () =>
      JSON.parse(readFileSync(join(home, "fake-thread.json"), "utf8"));
    // Establish an existing interactive thread before the report arrives.
    await Effect.runPromise(
      sendConversation({ ...input([]), text: "hello" }, () => {}),
    );
    const chatId = thread().id;
    await Effect.runPromise(
      sendConversation(
        input([...forbidden, "roost_read_feed", "roost_read_soul"]),
        () => {},
        undefined,
        "handoff",
      ),
    );
    const handoff = thread();
    assert.notEqual(handoff.id, chatId);
    assert.deepEqual(handoff.options.dynamicTools, []);
    for (const { response } of handoff.capabilityResults) {
      assert.equal(response.result.success, false);
      assert.match(
        response.result.contentItems[0].text,
        /This run cannot use that tool/,
      );
    }
    await Effect.runPromise(
      sendConversation(
        input([...forbidden, "roost_read_feed"]),
        () => {},
        {
          id: FEED_EDITOR_AUTOMATION_ID,
          agentId: agent.id,
          name: "Feed editor",
          prompt: "Curate",
          notification: "when-needed",
          revision: 1,
          enabled: true,
          nextRunAt: null,
          schedule: { kind: "interval", minutes: 60 },
        },
        "automation",
      ),
    );
    const feed = thread();
    assert.deepEqual(
      feed.options.dynamicTools.map((tool: { name: string }) => tool.name),
      ["roost_read_feed", "roost_publish_feed_item"],
    );
    for (const { tool, response } of feed.capabilityResults)
      assert.equal(response.result.success, tool === "roost_read_feed");
    for (const restricted of [handoff, feed]) {
      assert.equal(restricted.options.sandbox, "read-only");
      assert.equal(restricted.options.approvalPolicy, "never");
      assert.equal(restricted.options.config["features.apps"], false);
      for (const feature of [
        "shell_tool",
        "unified_exec",
        "computer_use",
        "browser_use",
        "browser_use_external",
        "browser_use_full_cdp_access",
        "image_generation",
      ])
        assert.equal(restricted.options.config[`features.${feature}`], false);
      assert.equal(restricted.options.config.web_search, "disabled");
      assert.equal(
        restricted.options.config["sandbox_read_only.network_access"],
        false,
      );
    }
    await Effect.runPromise(
      sendConversation(
        { ...input([]), text: "approval:command" },
        () => {},
        undefined,
        "handoff",
      ),
    );
    assert.match(
      thread().turns.at(-1).items[1].text,
      /Roost could not handle this request/,
    );
    // Fresh chat returns to the original interactive conversation.
    await Effect.runPromise(
      sendConversation({ ...input([]), text: "hello again" }, () => {}),
    );
    assert.equal(thread().id, chatId);
    assert.ok(
      thread().options.dynamicTools.some(
        (tool: { name: string }) => tool.name === "roost_computer",
      ),
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

test("generic dispatch enforces restricted capabilities before every branch", async () => {
  for (const capabilities of [
    runCapabilities("handoff"),
    runCapabilities("automation", FEED_EDITOR_AUTOMATION_ID),
  ]) {
    for (const { name } of agentTools) {
      if (capabilities.tools.includes(name)) continue;
      const result = await handleAgentTool(
        { agentId: randomUUID(), allowMutations: true, capabilities },
        name,
        {},
      );
      assert.equal(result.success, false, name);
      assert.match(
        (result.contentItems[0] as { text: string }).text,
        /This run cannot use that tool/,
      );
    }
  }
});
