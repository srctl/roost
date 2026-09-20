import { Effect, Schema } from "effect";
import { decodeShowDashboard } from "../../features/dashboards/chat";
import {
  type DashboardPresentation,
  dashboardPlanForFocus,
} from "../../features/dashboards/presentation";
import {
  DashboardDataset,
  DashboardKey,
  DashboardWidget,
} from "../../features/dashboards/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { requireConversation } from "../runs/threads.server";
import { putMessage } from "../runs/timeline.server";
import { writeTransaction } from "../transaction.server";

export const readChatDashboard = (agentId: string, key: string) =>
  withAgentStore((db) => {
    assertAvailable(db);
    requireAgent(db, agentId);
    Schema.decodeUnknownSync(DashboardKey)(key);
    const enabled =
      db.prepare("SELECT enabled FROM dashboard_settings WHERE id=1").get()
        ?.enabled === 1;
    const row = enabled
      ? db
          .prepare("SELECT * FROM dashboards WHERE agentId=? AND key=?")
          .get(agentId, key)
      : undefined;
    const widgets: DashboardWidget[] = row
      ? [
          Schema.decodeUnknownSync(DashboardWidget)({
            ...row,
            blocks: JSON.parse(String(row.blocks)),
          }),
        ]
      : [];
    const keys = new Set(
      widgets.flatMap((widget) =>
        widget.blocks.flatMap((block) =>
          block.type === "dataset-chart" ? [block.datasetKey] : [],
        ),
      ),
    );
    const datasets: DashboardDataset[] = [];
    for (const datasetKey of keys) {
      const dataset = db
        .prepare("SELECT * FROM dashboard_datasets WHERE agentId=? AND key=?")
        .get(agentId, datasetKey);
      if (dataset)
        datasets.push(
          Schema.decodeUnknownSync(DashboardDataset)({
            ...JSON.parse(String(dataset.content)),
            agentId,
            key: dataset.key,
            revision: dataset.revision,
            updatedAt: dataset.updatedAt,
          }),
        );
    }
    const widget = widgets[0];
    const presentation: DashboardPresentation = {
      plan: widget
        ? dashboardPlanForFocus(widgets, datasets, "all", key)
        : null,
      intent: "",
      focus: widget ? "all" : null,
      widgetKey: widget ? key : null,
      revision: widget?.revision ?? 0,
      updatedAt: widget?.updatedAt ?? 0,
      canAdapt: false,
      availableFocus: widget ? ["all"] : [],
      notice: !enabled
        ? "Dashboards are disabled."
        : !widget
          ? "This tracker is no longer available."
          : null,
    };
    return { enabled, widgets, datasets, presentation };
  });

export const showDashboard = (
  agentId: string,
  runId: string | undefined,
  input: unknown,
) =>
  Effect.gen(function* () {
    const data = yield* Effect.try({
      try: () => decodeShowDashboard(input),
      catch: () =>
        new AgentStoreError({ message: "Provide only a saved dashboard key." }),
    });
    return yield* withAgentStore((db) =>
      writeTransaction(db, () => {
        assertAvailable(db);
        requireAgent(db, agentId);
        const source = runId
          ? db
              .prepare(
                "SELECT kind,status,cancelRequested,conversationId FROM runs WHERE id=? AND agentId=?",
              )
              .get(runId, agentId)
          : undefined;
        if (
          source?.kind !== "chat" ||
          source.status !== "running" ||
          source.cancelRequested !== 0
        )
          throw new AgentStoreError({
            message:
              "Inline trackers require an active, uncancelled user chat run for this agent.",
          });
        const conversationId = String(source.conversationId || agentId);
        requireConversation(db, agentId, conversationId);
        if (
          db.prepare("SELECT enabled FROM dashboard_settings WHERE id=1").get()
            ?.enabled !== 1
        )
          throw new AgentStoreError({
            message:
              "Dashboards are off. The user can enable them in Settings.",
          });
        const widget = db
          .prepare("SELECT title FROM dashboards WHERE agentId=? AND key=?")
          .get(agentId, data.key);
        if (!widget)
          throw new AgentStoreError({
            message:
              "Dashboard not found. Save this tracker before showing it.",
          });
        const id = `dashboard:${runId}:${data.key}`;
        const existing = db
          .prepare(
            "SELECT id FROM timeline WHERE agentId=? AND conversationId=? AND id=?",
          )
          .get(agentId, conversationId, id);
        if (!existing)
          putMessage(
            db,
            agentId,
            {
              id,
              role: "assistant",
              text: `Your "${widget.title}" tracker is available in Dashboard.`,
              ui: { type: "dashboard", key: data.key },
            },
            conversationId,
          );
        return {
          id,
          key: data.key,
          displayed: true,
          duplicate: !!existing,
          message:
            "This saved tracker is rendered inline in the current conversation. The user can edit it here. Do not duplicate its contents in prose.",
        };
      }),
    );
  });
