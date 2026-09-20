import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { Message } from "../src/features/chat/schema";
import {
  dashboardMessageUI,
  decodeChatDashboardInput,
} from "../src/features/dashboards/chat";
import { validateDashboardPlan } from "../src/features/dashboards/presentation";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { handleAgentTool } from "../src/server/codex/agent-tools.server";
import { readChatDashboard } from "../src/server/dashboards/chat.server";
import {
  readDashboard,
  updateDashboardPresentation,
} from "../src/server/dashboards/presentation.server";
import {
  deleteDashboard,
  saveDashboard,
  saveDataset,
  setDashboardPreference,
} from "../src/server/dashboards/store.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import { readConversationSnapshot } from "../src/server/runs/conversation-snapshot.server";
import {
  cancelRun,
  claimRun,
  enqueueChat,
  finishRun,
  persistRun,
  schedulerTick,
} from "../src/server/runs/store.server";
import {
  deleteReplyThread,
  openReplyThread,
} from "../src/server/runs/threads.server";
import { readTimeline } from "../src/server/runs/timeline.server";

const run = Effect.runPromise;

test("chat UI references are bounded and unknown extensions preserve readable messages", () => {
  const reference = { type: "dashboard", key: "my-todos" };
  assert.deepEqual(dashboardMessageUI(reference), reference);
  const message = {
    id: "1",
    role: "assistant",
    text: "Fallback for older clients.",
  };
  assert.deepEqual(
    Schema.decodeUnknownSync(Message)({ ...message, ui: reference }).ui,
    reference,
  );
  for (const ui of [
    null,
    "<script>unsafe</script>",
    { type: "future-ui", key: "my-todos" },
    { type: "dashboard", key: "../private" },
    { type: "dashboard", key: "x".repeat(65) },
    { type: "dashboard", key: "my-todos", html: "<script>unsafe</script>" },
    { type: "dashboard", key: "my-todos", agentId: randomUUID() },
  ]) {
    assert.equal(dashboardMessageUI(ui), undefined);
    const decoded = Schema.decodeUnknownSync(Message)({ ...message, ui });
    assert.equal(decoded.ui, undefined);
    assert.equal(decoded.text, message.text);
  }
  const input = { agentId: randomUUID(), key: "my-todos" };
  assert.deepEqual(decodeChatDashboardInput(input), input);
  for (const invalid of [
    { ...input, key: "bad key" },
    { ...input, conversationId: randomUUID() },
    { ...input, agentId: "missing" },
  ])
    assert.throws(() => decodeChatDashboardInput(invalid));
});

test("inline trackers persist in their owned chat and return only referenced live data", async (t) => {
  const directory = mkdtempSync("/tmp/roost-dashboard-chat-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const token = tokens.create("Inline tracker tests");
  const handle = createMobileHandler(async () => {});
  const agent = await run(
    saveAgent({
      id: randomUUID(),
      name: "Tracker",
      instructions: "Help",
      model: "fixture",
      character: "wisp",
    }),
  );
  const other = await run(
    saveAgent({
      id: randomUUID(),
      name: "Other",
      instructions: "Help",
      model: "fixture",
      character: "moss",
    }),
  );
  const request = async (path: string, data?: unknown, authorized = true) => {
    const response = await handle(
      new Request(`https://roost.example/api/mobile/v1/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(authorized ? { Authorization: `Bearer ${token.secret}` } : {}),
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
    );
    assert.ok(response);
    return { status: response.status, value: await response.json() };
  };
  const start = async (conversationId = agent.id) => {
    const messageId = randomUUID();
    await run(
      enqueueChat({
        agentId: agent.id,
        messageId,
        conversationId,
        text: "Make a tracker",
      }),
    );
    await run(schedulerTick("inline-test"));
    const active = await run(claimRun("inline-test"));
    assert.ok(active);
    assert.equal(active.id, messageId);
    return active;
  };
  try {
    await run(setDashboardPreference(true));
    const main = await start();
    const context = { agentId: agent.id, runId: main.id, allowMutations: true };
    const key = "daily-tracker";
    const tool = (name: string, input: unknown) =>
      handleAgentTool(context, name, input);
    let mainCardId = "";

    await t.test(
      "save then show produces one durable assistant card without repeated content",
      async () => {
        const saved = await tool("roost_save_dashboard", {
          key,
          title: "Daily tracker",
          blocks: [
            { type: "todo-list", id: "todos", items: [] },
            { type: "calorie-log", id: "meals", entries: [] },
            { type: "metrics", items: [{ label: "Days", value: "1" }] },
          ],
        });
        assert.equal(saved.success, true);
        assert.equal(
          (await run(readTimeline(agent.id))).length,
          1,
          "save is quiet",
        );
        const shown = await tool("roost_show_dashboard", { key });
        assert.equal(shown.success, true);
        assert.match(JSON.stringify(shown), /rendered inline/);
        const first = await run(readConversationSnapshot(agent.id));
        const card = first.entries.find(
          ({ message }) => message.ui?.key === key,
        )?.message;
        assert.ok(card);
        mainCardId = card.id;
        assert.equal(card.id, `dashboard:${main.id}:${key}`);
        assert.equal(card.role, "assistant");
        assert.equal(
          card.text,
          'Your "Daily tracker" tracker is available in Dashboard.',
        );
        assert.deepEqual(card.ui, { type: "dashboard", key });
        assert.ok(!("blocks" in card.ui));
        const repeats = await Promise.all([
          tool("roost_show_dashboard", { key }),
          tool("roost_show_dashboard", { key }),
        ]);
        assert.ok(repeats.every((result) => result.success));
        assert.ok(
          repeats.every((result) =>
            JSON.stringify(result).includes('"duplicate\\":true'),
          ),
        );
        const after = await run(readConversationSnapshot(agent.id));
        assert.equal(
          after.revision,
          first.revision,
          "duplicate show does not touch timeline revision",
        );
        assert.equal(
          after.entries.filter(({ message }) => message.ui).length,
          1,
        );
        await run(
          persistRun(main, [
            { id: "provider-answer", role: "assistant", text: "Ready." },
          ]),
        );
        await run(
          finishRun(main, "completed", [
            { id: "provider-answer", role: "assistant", text: "Ready." },
          ]),
        );
        assert.equal(
          (await run(readTimeline(agent.id))).filter((message) => message.ui)
            .length,
          1,
        );
        assert.equal(
          (await tool("roost_show_dashboard", { key })).success,
          false,
        );
      },
    );

    const reply = await run(openReplyThread(agent.id, mainCardId));
    const active = await start(reply.id);
    const replyContext = { ...context, runId: active.id };
    const show = (input: unknown = { key }) =>
      handleAgentTool(replyContext, "roost_show_dashboard", input);

    await t.test(
      "reply cards stay in the originating thread and cannot be rerouted by arguments",
      async () => {
        assert.equal((await show()).success, true);
        const replyPage = await request(
          `agents/${agent.id}/conversation?conversationId=${reply.id}`,
        );
        assert.equal(replyPage.status, 200);
        const cards = replyPage.value.entries.filter(
          ({ message }: { message: Message }) => message.ui,
        );
        assert.equal(cards.length, 1);
        assert.equal(cards[0].message.id, `dashboard:${active.id}:${key}`);
        assert.deepEqual(cards[0].message.ui, { type: "dashboard", key });
        assert.equal(
          (await run(readTimeline(agent.id))).filter((message) => message.ui)
            .length,
          1,
        );
        assert.equal((await run(readTimeline(other.id))).length, 0);
        for (const invalid of [
          { key, agentId: other.id },
          { key, conversationId: agent.id },
          { key, html: "<script>unsafe</script>" },
          { key: "missing" },
          { key: "bad key" },
        ])
          assert.equal((await show(invalid)).success, false);
        assert.equal(
          (
            await handleAgentTool(
              { ...replyContext, agentId: other.id },
              "roost_show_dashboard",
              { key },
            )
          ).success,
          false,
        );
        assert.equal(
          (
            await handleAgentTool(
              { ...replyContext, runId: undefined },
              "roost_show_dashboard",
              { key },
            )
          ).success,
          false,
        );
        assert.equal(
          (
            await handleAgentTool(
              { ...replyContext, allowMutations: false },
              "roost_show_dashboard",
              { key },
            )
          ).success,
          false,
        );
        assert.equal(
          (
            await handleAgentTool(
              { ...replyContext, allowMutations: "reflection" },
              "roost_show_dashboard",
              { key },
            )
          ).success,
          false,
        );
      },
    );

    await t.test(
      "chat fetch ignores saved focus, isolates data sources and uses current editable contents",
      async () => {
        for (const datasetKey of ["referenced", "unrelated"])
          await run(
            saveDataset(agent.id, {
              key: datasetKey,
              title: datasetKey,
              columns: [
                { key: "day", label: "Day", type: "string" },
                { key: "count", label: "Count", type: "number" },
              ],
              rows: [["Monday", 3]],
            }),
          );
        await run(
          saveDataset(other.id, {
            key: "referenced",
            title: "Private other source",
            columns: [{ key: "secret", label: "Secret", type: "string" }],
            rows: [["Do not expose"]],
          }),
        );
        const existing = (await run(readChatDashboard(agent.id, key)))
          .widgets[0]!;
        await run(
          saveDashboard(agent.id, {
            key,
            title: existing.title,
            expectedRevision: existing.revision,
            blocks: [
              ...existing.blocks,
              {
                type: "dataset-chart",
                datasetKey: "referenced",
                title: "Count",
                style: "bar",
                x: "day",
                series: [{ column: "count", label: "Count" }],
              },
            ],
          }),
        );
        await run(
          saveDashboard(agent.id, {
            key: "unrelated",
            title: "Unrelated widget",
            blocks: [{ type: "markdown", text: "Do not expose" }],
          }),
        );
        await run(
          saveDashboard(other.id, {
            key,
            title: "Other agent tracker",
            blocks: [{ type: "todo-list", id: "todos", items: [] }],
          }),
        );
        await run(
          updateDashboardPresentation(agent.id, {
            revision: 0,
            focus: "summary",
          }),
        );
        const savedPresentation = (await run(readDashboard(agent.id)))
          .presentation;
        const snapshot = await request(
          `agents/${agent.id}/dashboard/chat?key=${key}`,
        );
        assert.equal(snapshot.status, 200);
        assert.equal(snapshot.value.widgets.length, 1);
        assert.equal(snapshot.value.widgets[0].key, key);
        assert.deepEqual(
          snapshot.value.datasets.map(
            (dataset: { key: string }) => dataset.key,
          ),
          ["referenced"],
        );
        assert.equal(snapshot.value.presentation.focus, "all");
        assert.equal(snapshot.value.presentation.widgetKey, key);
        assert.equal(snapshot.value.presentation.canAdapt, false);
        assert.ok(
          validateDashboardPlan(
            snapshot.value.presentation.plan,
            snapshot.value.widgets,
            snapshot.value.datasets,
          ),
        );
        assert.deepEqual(snapshot.value.presentation.plan.nodes[0].props, {
          focus: "all",
          widgetKeys: [key],
          showDataSources: false,
        });
        assert.deepEqual(
          (await run(readDashboard(agent.id))).presentation,
          savedPresentation,
        );
        const id = randomUUID();
        const changed = await request(`agents/${agent.id}/dashboard/action`, {
          key,
          expectedRevision: 2,
          blockId: "todos",
          action: "add-todo",
          id,
          label: "Actual saved task",
        });
        assert.equal(changed.status, 200);
        const reloaded = await run(readChatDashboard(agent.id, key));
        assert.equal(reloaded.widgets[0]!.revision, 3);
        const todos = reloaded.widgets[0]!.blocks.find(
          (block) => block.type === "todo-list",
        );
        assert.equal(todos?.items[0]?.label, "Actual saved task");
        assert.equal(
          (await run(readChatDashboard(other.id, key))).widgets[0]!.title,
          "Other agent tracker",
        );
        assert.equal(
          (
            await handleAgentTool(
              { ...replyContext, agentId: other.id },
              "roost_show_dashboard",
              { key },
            )
          ).success,
          false,
          "a real widget owned by another agent does not make this run theirs",
        );
        // Simulate a legacy damaged reference: mobile clients must receive the
        // same clear chart fallback from both dashboard endpoints.
        await run(
          withAgentStore((db) =>
            db
              .prepare(
                "DELETE FROM dashboard_datasets WHERE agentId=? AND key='referenced'",
              )
              .run(agent.id),
          ),
        );
        const inline = (
          await request(`agents/${agent.id}/dashboard/chat?key=${key}`)
        ).value;
        const regular = (await request(`agents/${agent.id}/dashboard`)).value;
        const chartError = (value: typeof inline) =>
          value.widgets
            .find((widget: { key: string }) => widget.key === key)
            .blocks.find(
              (block: { type: string }) => block.type === "dataset-chart",
            ).chartError;
        assert.match(chartError(inline), /Data source is missing/);
        assert.equal(chartError(inline), chartError(regular));
        assert.deepEqual(inline.datasets, []);
      },
    );

    await t.test(
      "authenticated reads reject invalid queries and missing content never falls back to other widgets",
      async () => {
        const path = `agents/${agent.id}/dashboard/chat`;
        assert.equal(
          (await request(`${path}?key=${key}`, undefined, false)).status,
          401,
        );
        for (const query of [
          "",
          "?key=",
          "?key=bad%20key",
          `?key=${"x".repeat(65)}`,
          `?key=${key}&key=unrelated`,
          `?key=${key}&agentId=${other.id}`,
        ])
          assert.equal((await request(path + query)).status, 400);
        assert.equal(
          (await request(`agents/${randomUUID()}/dashboard/chat?key=${key}`))
            .status,
          400,
        );
        const missing = await request(`${path}?key=missing`);
        assert.equal(missing.status, 200);
        assert.deepEqual(missing.value.widgets, []);
        assert.deepEqual(missing.value.datasets, []);
        assert.equal(missing.value.presentation.plan, null);
        assert.equal(
          missing.value.presentation.notice,
          "This tracker is no longer available.",
        );
        await run(setDashboardPreference(false));
        const disabled = await request(`${path}?key=${key}`);
        assert.equal(disabled.status, 200);
        assert.equal(disabled.value.enabled, false);
        assert.deepEqual(disabled.value.widgets, []);
        assert.deepEqual(disabled.value.datasets, []);
        assert.equal(
          disabled.value.presentation.notice,
          "Dashboards are disabled.",
        );
        assert.equal((await show()).success, false);
        await run(setDashboardPreference(true));
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1")
              .run(),
          ),
        );
        assert.equal((await request(`${path}?key=${key}`)).status, 400);
        assert.equal((await show()).success, false);
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runtime_control SET maintenance=0 WHERE id=1")
              .run(),
          ),
        );
        await run(deleteDashboard(agent.id, { key, expectedRevision: 3 }));
        const removed = await request(`${path}?key=${key}`);
        assert.deepEqual(removed.value.widgets, []);
        assert.deepEqual(removed.value.datasets, []);
        assert.equal(
          (await run(readTimeline(agent.id, reply.id))).filter(
            (message) => message.ui,
          ).length,
          1,
          "historical reference survives deletion",
        );
      },
    );

    await t.test(
      "background, queued, cancelled and deleted conversations cannot post cards",
      async () => {
        await run(
          saveDashboard(agent.id, {
            key,
            title: "Restored",
            blocks: [{ type: "todo-list", id: "todos", items: [] }],
          }),
        );
        const before = await run(
          readConversationSnapshot(agent.id, { conversationId: reply.id }),
        );
        for (const kind of [
          "automation",
          "delegation",
          "handoff",
          "reflection",
          "coding",
        ])
          await run(
            withAgentStore((db) => {
              db.prepare("UPDATE runs SET kind=? WHERE id=?").run(
                kind,
                active.id,
              );
            }),
          ).then(async () => assert.equal((await show()).success, false));
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runs SET kind='chat',status='queued' WHERE id=?")
              .run(active.id),
          ),
        );
        assert.equal((await show()).success, false);
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runs SET status='running' WHERE id=?")
              .run(active.id),
          ),
        );
        await run(cancelRun(agent.id, active.id));
        assert.equal((await show()).success, false);
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runs SET cancelRequested=0 WHERE id=?")
              .run(active.id),
          ),
        );
        await run(deleteReplyThread(agent.id, reply.id));
        // Even a stale callback with a mistakenly cleared cancel flag cannot reopen the thread.
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runs SET cancelRequested=0 WHERE id=?")
              .run(active.id),
          ),
        );
        assert.equal((await show()).success, false);
        assert.equal(
          (await run(readTimeline(agent.id, reply.id))).filter(
            (message) => message.ui,
          ).length,
          1,
        );
        const count = await run(
          withAgentStore(
            (db) =>
              db
                .prepare("SELECT value FROM timeline_revision WHERE id=1")
                .get()!.value,
          ),
        );
        assert.equal(count, before.revision);
      },
    );
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
