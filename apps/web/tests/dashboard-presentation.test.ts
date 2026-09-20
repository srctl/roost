import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { resolvePlan } from "juxi";
import {
  availableDashboardFocus,
  createDashboardViews,
  dashboardOptionForFocus,
  dashboardPlanForFocus,
  dashboardSelectionForPlan,
  filterDashboardWidgets,
  validateDashboardPlan,
} from "../src/features/dashboards/presentation";
import { deleteAgentRecords } from "../src/server/agents/delete.server";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
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

const run = Effect.runPromise;

test("Juxi dashboards validate owned content, persist revisions and enforce mobile boundaries", async (t) => {
  const directory = mkdtempSync("/tmp/roost-juxi-");
  const previousDirectory = process.env.ROOST_DATA_DIR;
  const previousKey = process.env.TYPESAFE_API_KEY;
  process.env.ROOST_DATA_DIR = directory;
  delete process.env.TYPESAFE_API_KEY;
  const tokens = new MobileTokens(directory);
  const device = tokens.create("Juxi test");
  const handle = createMobileHandler(async () => {});
  const agent = await run(
    saveAgent({
      id: randomUUID(),
      name: "Dashboard",
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
  const path = `agents/${agent.id}/dashboard`;
  const request = async (url: string, data?: unknown, authorized = true) => {
    const response = await handle(
      new Request(`https://roost.example/api/mobile/v1/${url}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(authorized ? { Authorization: `Bearer ${device.secret}` } : {}),
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
    );
    assert.ok(response);
    return { status: response.status, value: await response.json() };
  };
  try {
    await t.test(
      "disabled, unauthorized and invalid identity cannot change views",
      async () => {
        assert.equal(
          (
            await request(
              `${path}/presentation`,
              { focus: "all", revision: 0 },
              false,
            )
          ).status,
          401,
        );
        assert.equal(
          (await request(`${path}/presentation`, { focus: "all", revision: 0 }))
            .status,
          400,
        );
        assert.equal(
          (await request(`agents/${randomUUID()}/dashboard`)).status,
          400,
        );
        assert.equal((await request(path)).value.presentation.plan, null);
      },
    );
    await run(setDashboardPreference(true));
    await run(
      saveDataset(agent.id, {
        key: "values",
        title: "Values",
        columns: [{ key: "value", label: "Value", type: "number" }],
        rows: [[7]],
      }),
    );
    await run(
      saveDashboard(agent.id, {
        key: "mixed",
        title: "Overview",
        blocks: [
          {
            type: "markdown",
            text: "Private raw notes never sent to the planner",
          },
          { type: "metrics", items: [{ label: "Count", value: "7" }] },
          {
            type: "chart",
            title: "Growth",
            style: "line",
            points: [{ label: "Mon", value: 7 }],
          },
          { type: "tasks", items: [{ label: "Ship it", status: "todo" }] },
        ],
      }),
    );
    await t.test(
      "manual choices work without credentials and isolate each agent",
      async () => {
        const initial = (await request(path)).value;
        assert.equal(initial.presentation.canAdapt, false);
        assert.deepEqual(initial.presentation.availableFocus, [
          "all",
          "summary",
          "charts",
          "tables",
          "tasks",
        ]);
        assert.equal(
          (
            await request(`${path}/presentation`, {
              focus: "charts",
              revision: 0,
              agentId: other.id,
            })
          ).status,
          400,
        );
        const changed = await request(`${path}/presentation`, {
          focus: "charts",
          revision: 0,
        });
        assert.equal(changed.status, 200);
        assert.equal(changed.value.focus, "charts");
        assert.equal(changed.value.revision, 1);
        assert.deepEqual(changed.value.plan.nodes[0].props, {
          focus: "charts",
          widgetKeys: ["mixed"],
          showDataSources: false,
        });
        assert.deepEqual(
          (await request(path)).value.presentation,
          changed.value,
        );
        assert.equal(
          (await request(`agents/${other.id}/dashboard`)).value.presentation
            .revision,
          0,
        );
        assert.equal(
          (
            await request(`${path}/presentation`, {
              focus: "tasks",
              revision: 0,
            })
          ).status,
          409,
        );
        for (const invalid of [
          { focus: "unknown", revision: 1 },
          { focus: "tasks", intent: "tasks", revision: 1 },
          { revision: 1 },
          { intent: "x".repeat(501), revision: 1 },
          { focus: "all", revision: -1 },
        ])
          assert.equal(
            (await request(`${path}/presentation`, invalid)).status,
            400,
          );
        const unavailable = await request(`${path}/presentation`, {
          intent: "Show trends",
          revision: 1,
        });
        assert.equal(unavailable.value.revision, 1);
        assert.match(unavailable.value.notice, /unavailable/);
        assert.equal(unavailable.value.focus, "charts");
        const reset = await request(`${path}/presentation`, {
          intent: "  ",
          revision: 1,
        });
        assert.equal(reset.value.revision, 2);
        assert.equal(reset.value.plan, null);
        assert.equal(reset.value.focus, null);
      },
    );
    await t.test(
      "legacy saved views migrate without losing selection or revision",
      async () => {
        await run(
          withAgentStore((db) =>
            db.exec(
              "ALTER TABLE dashboard_presentations DROP COLUMN widgetKey",
            ),
          ),
        );
        const migrated = await run(readDashboard(agent.id));
        assert.equal(migrated.presentation.revision, 2);
        assert.equal(migrated.presentation.widgetKey, null);
      },
    );
    await t.test(
      "plans reject unknown components, arbitrary props and foreign or stale widget references",
      async () => {
        const { widgets, datasets } = await run(readDashboard(agent.id));
        const plan = dashboardPlanForFocus(widgets, datasets, "charts")!;
        assert.ok(validateDashboardPlan(plan, widgets, datasets));
        const node = plan.nodes[0]!;
        for (const invalid of [
          {},
          { ...plan, nodes: [{ ...node, component: "Unknown" }] },
          {
            ...plan,
            nodes: [{ ...node, props: { ...node.props, html: "<script>" } }],
          },
          {
            ...plan,
            nodes: [
              { ...node, props: { ...node.props, widgetKeys: ["foreign"] } },
            ],
          },
          {
            ...plan,
            nodes: [
              { ...node, props: { ...node.props, showDataSources: true } },
            ],
          },
          { ...plan, nodes: [node, node] },
        ])
          assert.equal(validateDashboardPlan(invalid, widgets, datasets), null);
        assert.equal(validateDashboardPlan(plan, [], datasets), null);
        assert.deepEqual(
          filterDashboardWidgets(widgets, "summary")[0]!.blocks.map(
            (block) => block.type,
          ),
          ["markdown", "metrics"],
        );
        assert.deepEqual(
          filterDashboardWidgets(widgets, "charts", ["foreign"]),
          [],
        );
        assert.deepEqual(availableDashboardFocus([], []), []);
        assert.equal(createDashboardViews([], []), null);
      },
    );
    process.env.TYPESAFE_API_KEY = "test-only-key";
    await t.test(
      "real Juxi/TypeSafe transport sees only intent and metadata; GET never calls it",
      async () => {
        let calls = 0;
        let confidence = 0.98;
        const mock = t.mock.method(
          globalThis,
          "fetch",
          async (_url: unknown, options?: RequestInit) => {
            calls++;
            const body = JSON.parse(String(options?.body));
            assert.equal(body.state.context.intent, "Show task progress");
            assert.ok(options?.signal);
            assert.equal(
              JSON.stringify(body).includes("Private raw notes"),
              false,
            );
            assert.equal(body.questions.dashboard.type, "choice");
            return Response.json({
              model: "jev-latest",
              usage: { input_tokens: 5, output_tokens: 5 },
              answers: {
                dashboard: {
                  type: "choice",
                  choice: "tasks",
                  confidence,
                  probabilities: { tasks: confidence, all: 1 - confidence },
                },
              },
            });
          },
        );
        const selected = await run(
          updateDashboardPresentation(agent.id, {
            intent: "Show task progress",
            revision: 2,
          }),
        );
        assert.equal(selected.focus, "tasks");
        assert.equal(selected.revision, 3);
        assert.equal(calls, 1);
        await run(readDashboard(agent.id));
        assert.equal(calls, 1);
        confidence = 0.2;
        const uncertain = await run(
          updateDashboardPresentation(agent.id, {
            intent: "Show task progress",
            revision: 3,
          }),
        );
        assert.equal(uncertain.focus, "all");
        assert.equal(uncertain.plan?.decisions[0]?.reason, "low-confidence");
        assert.match(uncertain.notice!, /No confident match/);
        assert.match(
          (await run(readDashboard(agent.id))).presentation.notice!,
          /No confident match/,
        );
        mock.mock.restore();
      },
    );
    await t.test(
      "invalid answers fall back and failures or timeouts preserve the current selection",
      async () => {
        const selected = await run(
          updateDashboardPresentation(
            agent.id,
            { intent: "Anything", revision: 4 },
            {
              planner: async (views) =>
                resolvePlan(views, {
                  dashboard: {
                    type: "choice",
                    choice: "invented",
                    confidence: 1,
                  },
                }),
            },
          ),
        );
        assert.equal(selected.focus, "all");
        assert.equal(selected.revision, 5);
        const invalid = await run(
          updateDashboardPresentation(
            agent.id,
            { intent: "Anything", revision: 5 },
            { planner: async () => ({ nodes: [] }) },
          ),
        );
        assert.equal(invalid.revision, 5);
        assert.match(invalid.notice!, /invalid view/);
        const failed = await run(
          updateDashboardPresentation(
            agent.id,
            { intent: "Anything", revision: 5 },
            {
              planner: async () => {
                throw new Error("secret provider detail");
              },
            },
          ),
        );
        assert.equal(failed.revision, 5);
        assert.match(failed.notice!, /unavailable/);
        assert.equal(failed.notice!.includes("secret"), false);
        let signal: AbortSignal | undefined;
        const timeout = await run(
          updateDashboardPresentation(
            agent.id,
            { intent: "Anything", revision: 5 },
            {
              timeoutMs: 5,
              planner: async (_views, _state, value) => {
                signal = value;
                return new Promise(() => {});
              },
            },
          ),
        );
        assert.equal(timeout.revision, 5);
        assert.equal(signal?.aborted, true);
      },
    );
    await t.test(
      "slow planners cannot overwrite a newer view or a disabled dashboard",
      async () => {
        let finish!: () => void;
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const slow = run(
          updateDashboardPresentation(
            agent.id,
            { intent: "Tasks", revision: 5 },
            {
              planner: async (views) => {
                started();
                await new Promise<void>((resolve) => {
                  finish = resolve;
                });
                return resolvePlan(views, {
                  dashboard: { type: "choice", choice: "tasks", confidence: 1 },
                });
              },
            },
          ),
        );
        await ready;
        await run(
          updateDashboardPresentation(agent.id, {
            focus: "charts",
            revision: 5,
          }),
        );
        finish();
        await assert.rejects(slow, /PRESENTATION_CONFLICT/);
        assert.equal(
          (await run(readDashboard(agent.id))).presentation.focus,
          "charts",
        );
        const disabled = run(
          updateDashboardPresentation(
            agent.id,
            { intent: "Tasks", revision: 6 },
            {
              planner: async (views) => {
                await run(setDashboardPreference(false));
                return resolvePlan(views, {});
              },
            },
          ),
        );
        await assert.rejects(disabled, /Dashboards are off/);
        await run(setDashboardPreference(true));
        assert.equal(
          (await run(readDashboard(agent.id))).presentation.revision,
          6,
        );
      },
    );
    await t.test(
      "refresh uses latest data, missing content falls back and deletion removes saved presentation",
      async () => {
        await run(
          saveDashboard(agent.id, {
            key: "latest",
            title: "New chart",
            blocks: [
              {
                type: "chart",
                title: "New",
                style: "bar",
                points: [{ label: "Today", value: 9 }],
              },
            ],
          }),
        );
        assert.deepEqual(
          new Set(
            (await run(readDashboard(agent.id))).presentation.plan!.nodes[0]!
              .props.widgetKeys as string[],
          ),
          new Set(["mixed", "latest"]),
        );
        await run(
          deleteDashboard(agent.id, { key: "mixed", expectedRevision: 1 }),
        );
        await run(
          deleteDashboard(agent.id, { key: "latest", expectedRevision: 1 }),
        );
        const current = await run(readDashboard(agent.id));
        assert.equal(current.presentation.plan, null);
        assert.match(current.presentation.notice!, /no longer available/);
        assert.equal(current.datasets.length, 1);
        await run(deleteAgentRecords({ agentId: agent.id, name: agent.name }));
        const count = await run(
          withAgentStore((db) =>
            Number(
              db
                .prepare(
                  "SELECT COUNT(*) n FROM dashboard_presentations WHERE agentId=?",
                )
                .get(agent.id)?.n,
            ),
          ),
        );
        assert.equal(count, 0);
        await assert.rejects(
          run(
            updateDashboardPresentation(agent.id, {
              focus: "all",
              revision: 6,
            }),
          ),
          /Agent not found|deleted/,
        );
      },
    );
    await t.test(
      "topic choices isolate one tracker, retain scope on refresh and clear it on manual selection",
      async () => {
        const scoped = await run(
          saveAgent({
            id: randomUUID(),
            name: "Topics",
            instructions: "Help",
            model: "fixture",
            character: "wisp",
          }),
        );
        const targetKey = "z".repeat(64);
        const target = {
          key: targetKey,
          title: "Balcony garden",
          blocks: [
            {
              type: "chart" as const,
              title: "Basil growth",
              style: "bar" as const,
              points: [{ label: "Week 1", value: 3 }],
            },
            {
              type: "tasks" as const,
              items: [{ label: "Water basil", status: "todo" as const }],
            },
          ],
        };
        await run(saveDashboard(scoped.id, target));
        await run(
          saveDashboard(scoped.id, {
            key: "workouts",
            title: "Workout progress",
            blocks: [
              {
                type: "chart",
                title: "Miles",
                style: "bar",
                points: [{ label: "Week 1", value: 9 }],
              },
            ],
          }),
        );
        await run(
          saveDataset(scoped.id, {
            key: "unrelated",
            title: "Unrelated source",
            columns: [{ key: "value", label: "Value", type: "number" }],
            rows: [[42]],
          }),
        );
        let snapshot = await run(readDashboard(scoped.id));
        const choice = dashboardOptionForFocus(
          "charts",
          targetKey,
          snapshot.widgets,
        );
        assert.equal(choice, "widget-1-charts");
        assert.ok(choice.length <= 64);
        const scopedPlan = dashboardPlanForFocus(
          snapshot.widgets,
          snapshot.datasets,
          "charts",
          targetKey,
        )!;
        assert.deepEqual(scopedPlan.nodes[0]!.props, {
          focus: "charts",
          widgetKeys: [targetKey],
          showDataSources: false,
        });
        assert.equal(
          dashboardSelectionForPlan(
            scopedPlan,
            snapshot.widgets,
            snapshot.datasets,
          )?.widgetKey,
          targetKey,
        );
        assert.equal(
          dashboardPlanForFocus(
            snapshot.widgets,
            snapshot.datasets,
            "tables",
            targetKey,
          ),
          null,
        );
        assert.equal(
          dashboardPlanForFocus(
            snapshot.widgets,
            snapshot.datasets,
            "charts",
            "foreign",
          ),
          null,
        );
        const wrongScope = {
          ...scopedPlan,
          decisions: [
            { ...scopedPlan.decisions[0]!, option: "widget-0-charts" },
          ],
        };
        assert.equal(
          validateDashboardPlan(
            wrongScope,
            snapshot.widgets,
            snapshot.datasets,
          ),
          null,
        );
        const extraSource = {
          ...scopedPlan,
          nodes: [
            {
              ...scopedPlan.nodes[0]!,
              props: { ...scopedPlan.nodes[0]!.props, showDataSources: true },
            },
          ],
        };
        assert.equal(
          validateDashboardPlan(
            extraSource,
            snapshot.widgets,
            snapshot.datasets,
          ),
          null,
        );
        const combined = {
          ...scopedPlan,
          nodes: [
            {
              ...scopedPlan.nodes[0]!,
              props: {
                ...scopedPlan.nodes[0]!.props,
                widgetKeys: [targetKey, "workouts"],
              },
            },
          ],
        };
        assert.equal(
          validateDashboardPlan(combined, snapshot.widgets, snapshot.datasets),
          null,
        );
        const selected = await run(
          updateDashboardPresentation(
            scoped.id,
            { intent: "Show balcony garden growth", revision: 0 },
            {
              planner: async (views, state) => {
                assert.ok(JSON.stringify(state).includes(targetKey));
                assert.match(
                  views.slots[0]!.options[choice]!.description,
                  /Balcony garden/,
                );
                // A concurrent inventory change shifts indices. Persist/rebuild by key.
                await run(
                  saveDashboard(scoped.id, {
                    key: "a-new",
                    title: "Other topic",
                    blocks: [{ type: "markdown", text: "Unrelated" }],
                  }),
                );
                return resolvePlan(views, {
                  dashboard: { type: "choice", choice, confidence: 0.98 },
                });
              },
            },
          ),
        );
        assert.equal(selected.widgetKey, targetKey);
        assert.equal(selected.plan!.decisions[0]!.option, "widget-2-charts");
        snapshot = await run(readDashboard(scoped.id));
        assert.equal(snapshot.presentation.widgetKey, targetKey);
        assert.ok(
          validateDashboardPlan(
            snapshot.presentation.plan,
            snapshot.widgets,
            snapshot.datasets,
          ),
        );
        assert.equal(
          (await request(`agents/${scoped.id}/dashboard`)).value.presentation
            .widgetKey,
          targetKey,
        );
        await run(
          saveDashboard(scoped.id, {
            ...target,
            title: "Garden this week",
            expectedRevision: 1,
          }),
        );
        snapshot = await run(readDashboard(scoped.id));
        assert.equal(snapshot.presentation.widgetKey, targetKey);
        assert.equal(
          filterDashboardWidgets(snapshot.widgets, "charts", [targetKey])[0]!
            .title,
          "Garden this week",
        );
        const manual = await run(
          updateDashboardPresentation(scoped.id, {
            focus: "charts",
            revision: 1,
          }),
        );
        assert.equal(manual.widgetKey, null);
        assert.equal(
          (manual.plan!.nodes[0]!.props.widgetKeys as string[]).length,
          2,
        );
        const scopedAll = await run(
          updateDashboardPresentation(
            scoped.id,
            { intent: "Everything about garden", revision: 2 },
            {
              planner: async (views) =>
                resolvePlan(views, {
                  dashboard: {
                    type: "choice",
                    choice: dashboardOptionForFocus(
                      "all",
                      targetKey,
                      snapshot.widgets,
                    ),
                    confidence: 1,
                  },
                }),
            },
          ),
        );
        assert.equal(scopedAll.widgetKey, targetKey);
        assert.equal(scopedAll.plan!.nodes[0]!.props.showDataSources, false);
        await run(
          deleteDashboard(scoped.id, { key: targetKey, expectedRevision: 2 }),
        );
        const removed = await run(readDashboard(scoped.id));
        assert.equal(removed.presentation.widgetKey, null);
        assert.equal(removed.presentation.plan, null);
        assert.match(removed.presentation.notice!, /no longer available/);
        const reset = await run(
          updateDashboardPresentation(scoped.id, { intent: "", revision: 3 }),
        );
        assert.equal(reset.widgetKey, null);
        assert.equal(reset.focus, null);
        assert.equal(reset.notice, null);
      },
    );
  } finally {
    tokens.close();
    t.mock.restoreAll();
    if (previousDirectory === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previousDirectory;
    if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previousKey;
    rmSync(directory, { recursive: true, force: true });
  }
});
