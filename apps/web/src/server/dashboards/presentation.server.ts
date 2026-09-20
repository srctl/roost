import type { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import type { UIPlan, UIState, Views } from "juxi";
import { createJevPlanner } from "juxi/server";
import {
  availableDashboardFocus,
  type ChangeDashboardPresentation,
  changeDashboardPresentationSchema,
  createDashboardViews,
  type DashboardFocus,
  type DashboardPresentation,
  dashboardFocusSchema,
  dashboardPlanForFocus,
  dashboardSelectionForPlan,
} from "../../features/dashboards/presentation";
import type {
  DashboardDataset,
  DashboardWidget,
} from "../../features/dashboards/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";
import {
  getDashboardPreference,
  listDashboards,
  listDatasets,
} from "./store.server";

const conflict = () =>
  new AgentStoreError({
    message:
      "PRESENTATION_CONFLICT: This dashboard view changed. Refresh and try again.",
  });
const hasCredentials = () => Boolean(process.env.TYPESAFE_API_KEY?.trim());

function storedPresentation(db: DatabaseSync, agentId: string) {
  return db
    .prepare("SELECT * FROM dashboard_presentations WHERE agentId=?")
    .get(agentId);
}

export const getDashboardPresentation = (
  agentId: string,
  widgets: readonly DashboardWidget[],
  datasets: readonly DashboardDataset[],
  enabled = true,
) =>
  withAgentStore((db): DashboardPresentation => {
    assertAvailable(db);
    requireAgent(db, agentId);
    const row = storedPresentation(db, agentId);
    const availableFocus = enabled
      ? availableDashboardFocus(widgets, datasets)
      : [];
    const focus = dashboardFocusSchema.safeParse(row?.focus);
    const widgetKey = row?.widgetKey == null ? null : String(row.widgetKey);
    const plan =
      enabled && focus.success
        ? dashboardPlanForFocus(widgets, datasets, focus.data, widgetKey)
        : null;
    const stale =
      focus.success &&
      !availableDashboardFocus(widgets, datasets, widgetKey).includes(
        focus.data,
      );
    // Regenerate references from the latest data instead of persisting copied widget content.
    return {
      plan,
      intent: String(row?.intent ?? ""),
      focus: plan && focus.success ? focus.data : null,
      widgetKey: plan ? widgetKey : null,
      revision: Number(row?.revision ?? 0),
      updatedAt: Number(row?.updatedAt ?? 0),
      canAdapt:
        enabled &&
        hasCredentials() &&
        createDashboardViews(widgets, datasets) !== null,
      availableFocus,
      notice: !enabled
        ? null
        : stale
          ? "This view is no longer available. Showing the complete dashboard."
          : row?.notice == null
            ? null
            : String(row.notice),
    };
  });

export const readDashboard = (agentId: string) =>
  Effect.gen(function* () {
    // Resolve identity even when dashboards are off.
    yield* withAgentStore((db) => {
      assertAvailable(db);
      requireAgent(db, agentId);
    });
    const { enabled } = yield* getDashboardPreference();
    const widgets = enabled ? yield* listDashboards(agentId) : [];
    const datasets = enabled ? yield* listDatasets(agentId) : [];
    const presentation = yield* getDashboardPresentation(
      agentId,
      widgets,
      datasets,
      enabled,
    );
    return { enabled, widgets, datasets, presentation };
  });

type Planner = (
  views: Views,
  state: UIState,
  signal: AbortSignal,
) => Promise<unknown>;
const livePlanner: Planner = (views, state, signal) =>
  createJevPlanner({
    views,
    model: process.env.TYPESAFE_MODEL || "jev-latest",
  })(state, signal);

async function planWithTimeout(
  views: Views,
  state: UIState,
  planner: Planner,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      planner(views, state, controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Dashboard planner timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Planner injection keeps failure/race tests independent of a live external account.
export const updateDashboardPresentation = (
  agentId: string,
  input: ChangeDashboardPresentation,
  options: { planner?: Planner; timeoutMs?: number } = {},
) =>
  Effect.gen(function* () {
    const data = yield* Effect.try({
      try: () => changeDashboardPresentationSchema.parse(input),
      catch: () =>
        new AgentStoreError({
          message:
            "Provide a valid dashboard focus or an intent of at most 500 characters, and the current revision.",
        }),
    });
    const snapshot = yield* readDashboard(agentId);
    if (!snapshot.enabled)
      return yield* Effect.fail(
        new AgentStoreError({
          message: "Dashboards are off. Enable them in Settings first.",
        }),
      );
    if (snapshot.presentation.revision !== data.revision)
      return yield* Effect.fail(conflict());
    const reset = data.intent === "";
    let focus: DashboardFocus | null = data.focus ?? null;
    let widgetKey: string | null = null;
    let notice: string | null = null;
    let selectedPlan: UIPlan | null = null;
    if (
      data.focus &&
      !snapshot.presentation.availableFocus.includes(data.focus)
    ) {
      return yield* Effect.fail(
        new AgentStoreError({
          message: "That dashboard view has no content. Choose another view.",
        }),
      );
    }
    if (data.intent && !reset) {
      if (!hasCredentials())
        return {
          ...snapshot.presentation,
          notice: "Custom views are unavailable. You can still choose a view.",
        };
      const views = createDashboardViews(snapshot.widgets, snapshot.datasets);
      if (!views)
        return {
          ...snapshot.presentation,
          notice: "Add dashboard content before adapting its view.",
        };
      const response = yield* Effect.tryPromise({
        try: () =>
          planWithTimeout(
            views,
            {
              intent: data.intent!,
              widgets: snapshot.widgets.map((widget) => ({
                key: widget.key,
                title: widget.title,
                blocks: widget.blocks.map((block) => block.type),
              })),
              datasets: snapshot.datasets.map((dataset) => ({
                key: dataset.key,
                title: dataset.title,
                columns: dataset.columns.map((column) => column.label),
              })),
            },
            options.planner ?? livePlanner,
            options.timeoutMs ?? 12_000,
          ),
        catch: () =>
          new AgentStoreError({
            message:
              "The view service is unavailable. Your current dashboard view is unchanged; try again or choose a view.",
          }),
      }).pipe(Effect.either);
      const afterPlan = yield* readDashboard(agentId);
      if (!afterPlan.enabled)
        return yield* Effect.fail(
          new AgentStoreError({
            message: "Dashboards are off. Enable them in Settings first.",
          }),
        );
      if (afterPlan.presentation.revision !== data.revision)
        return yield* Effect.fail(conflict());
      if (response._tag === "Left")
        return { ...afterPlan.presentation, notice: response.left.message };
      const selection = dashboardSelectionForPlan(
        response.right,
        snapshot.widgets,
        snapshot.datasets,
      );
      if (!selection)
        return {
          ...afterPlan.presentation,
          notice:
            "The view service returned an invalid view. Your current dashboard view is unchanged.",
        };
      selectedPlan = selection.plan;
      focus = selection.focus;
      widgetKey = selection.widgetKey;
      if (selectedPlan.decisions[0]?.reason !== "selected") {
        notice =
          "No confident match for that request. Showing the complete dashboard.";
      }
    }
    // Re-read current data after planning. The revision and enabled state are checked
    // again inside the synchronous write transaction, so slow responses cannot win.
    const current = yield* readDashboard(agentId);
    if (
      focus &&
      !availableDashboardFocus(
        current.widgets,
        current.datasets,
        widgetKey,
      ).includes(focus)
    ) {
      focus = null;
      widgetKey = null;
      notice =
        "Dashboard content changed while adapting the view. Showing the complete dashboard.";
    }
    yield* withAgentStore((db) =>
      writeTransaction(db, () => {
        assertAvailable(db);
        requireAgent(db, agentId);
        if (
          db.prepare("SELECT enabled FROM dashboard_settings WHERE id=1").get()
            ?.enabled !== 1
        ) {
          throw new AgentStoreError({
            message: "Dashboards are off. Enable them in Settings first.",
          });
        }
        if (
          Number(storedPresentation(db, agentId)?.revision ?? 0) !==
          data.revision
        )
          throw conflict();
        db.prepare(`INSERT INTO dashboard_presentations(agentId,focus,intent,revision,updatedAt,notice,widgetKey)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(agentId) DO UPDATE SET focus=excluded.focus,intent=excluded.intent,
      revision=excluded.revision,updatedAt=excluded.updatedAt,notice=excluded.notice,widgetKey=excluded.widgetKey`).run(
          agentId,
          focus,
          data.intent ?? "",
          data.revision + 1,
          Date.now(),
          notice,
          widgetKey,
        );
      }),
    );
    const result = yield* getDashboardPresentation(
      agentId,
      current.widgets,
      current.datasets,
    );
    // The first response retains the confidence explanation; saved focus refreshes
    // regenerate its safe nodes, while the explanatory notice remains persisted.
    if (
      selectedPlan &&
      result.plan &&
      result.focus === focus &&
      result.widgetKey === widgetKey
    ) {
      // Retain confidence/reason, but use the freshly regenerated option id: a
      // concurrent content edit may have changed the sorted widget inventory.
      result.plan.decisions[0] = {
        ...selectedPlan.decisions[0]!,
        option: result.plan.decisions[0]!.option,
      };
    }
    return result;
  });
