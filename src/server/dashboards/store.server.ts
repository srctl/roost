import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { chartDataError } from "../../features/dashboards/chart-data";
import {
  DashboardBlock,
  DashboardDataset,
  DashboardWidget,
  DeleteDashboard,
  SaveDashboard,
  SaveDataset,
} from "../../features/dashboards/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";

function enabled(db: DatabaseSync) {
  return (
    db.prepare("SELECT enabled FROM dashboard_settings WHERE id=1").get()
      ?.enabled === 1
  );
}

function requireEnabled(db: DatabaseSync) {
  assertAvailable(db);
  if (!enabled(db))
    throw new AgentStoreError({
      message: "Dashboards are off. The user can enable them in Settings.",
    });
}

export const getDashboardPreference = () =>
  withAgentStore((db) => ({ enabled: enabled(db) }));

export const setDashboardPreference = (value: boolean) =>
  withAgentStore((db) => {
    assertAvailable(db);
    db.prepare("UPDATE dashboard_settings SET enabled=? WHERE id=1").run(
      Number(value),
    );
    return { enabled: value };
  });

export const listDashboards = (agentId: string) =>
  withAgentStore((db) => {
    requireEnabled(db);
    requireAgent(db, agentId);
    const rows = db
      .prepare(
        "SELECT * FROM dashboards WHERE agentId=? ORDER BY updatedAt DESC,key",
      )
      .all(agentId);
    return rows.map((row) =>
      Schema.decodeUnknownSync(DashboardWidget)({
        ...row,
        blocks: JSON.parse(String(row.blocks)),
      }),
    );
  });

export const saveDashboard = (agentId: string, input: SaveDashboard) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      requireEnabled(db);
      requireAgent(db, agentId);
      const data = Schema.decodeUnknownSync(SaveDashboard)(input);
      validateReferences(data.blocks, readDatasets(db, agentId));
      const existing = db
        .prepare("SELECT revision FROM dashboards WHERE agentId=? AND key=?")
        .get(agentId, data.key);
      if (
        existing
          ? existing.revision !== data.expectedRevision
          : data.expectedRevision !== undefined
      )
        throw new AgentStoreError({
          message: "This dashboard changed. Read it again before saving.",
        });
      if (
        !existing &&
        Number(
          db
            .prepare("SELECT COUNT(*) AS count FROM dashboards WHERE agentId=?")
            .get(agentId)!.count,
        ) >= 30
      )
        throw new AgentStoreError({
          message:
            "Each agent can keep up to 30 dashboard widgets. Update or remove an existing widget first.",
        });
      const widget: DashboardWidget = {
        agentId,
        key: data.key,
        title: data.title,
        blocks: data.blocks,
        revision: existing ? Number(existing.revision) + 1 : 1,
        updatedAt: Date.now(),
      };
      db.prepare(
        "INSERT INTO dashboards (agentId,key,title,blocks,revision,updatedAt) VALUES (?,?,?,?,?,?) ON CONFLICT(agentId,key) DO UPDATE SET title=excluded.title,blocks=excluded.blocks,revision=excluded.revision,updatedAt=excluded.updatedAt",
      ).run(
        agentId,
        widget.key,
        widget.title,
        JSON.stringify(widget.blocks),
        widget.revision,
        widget.updatedAt,
      );
      return widget;
    }),
  );

export const deleteDashboard = (agentId: string, input: DeleteDashboard) =>
  withAgentStore((db) => {
    requireEnabled(db);
    requireAgent(db, agentId);
    const data = Schema.decodeUnknownSync(DeleteDashboard)(input);
    const result = db
      .prepare(
        "DELETE FROM dashboards WHERE agentId=? AND key=? AND revision=?",
      )
      .run(agentId, data.key, data.expectedRevision);
    if (!result.changes)
      throw new AgentStoreError({
        message: "This dashboard changed. Read it again before removing it.",
      });
    return { removed: true };
  });

function readDatasets(db: DatabaseSync, agentId: string) {
  return db
    .prepare("SELECT * FROM dashboard_datasets WHERE agentId=? ORDER BY key")
    .all(agentId)
    .map((row) =>
      Schema.decodeUnknownSync(DashboardDataset)({
        ...JSON.parse(String(row.content)),
        agentId,
        key: row.key,
        revision: row.revision,
        updatedAt: row.updatedAt,
      }),
    );
}

export const listDatasets = (agentId: string) =>
  withAgentStore((db) => {
    requireEnabled(db);
    requireAgent(db, agentId);
    return readDatasets(db, agentId);
  });

function validateReferences(
  blocks: DashboardWidget["blocks"],
  datasets: readonly DashboardDataset[],
) {
  for (const block of blocks) {
    if (block.type !== "dataset-chart") continue;
    const error = chartDataError(
      block,
      datasets.find((dataset) => dataset.key === block.datasetKey),
    );
    if (error) throw new AgentStoreError({ message: error });
  }
}

export const saveDataset = (agentId: string, input: SaveDataset) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      requireEnabled(db);
      requireAgent(db, agentId);
      const data = Schema.decodeUnknownSync(SaveDataset)(input);
      const datasets = readDatasets(db, agentId);
      const existing = datasets.find((dataset) => dataset.key === data.key);
      if (
        existing
          ? existing.revision !== data.expectedRevision
          : data.expectedRevision !== undefined
      )
        throw new AgentStoreError({
          message: "This data source changed. Read it again before saving.",
        });
      if (!existing && datasets.length >= 30)
        throw new AgentStoreError({
          message: "Each agent can keep up to 30 data sources.",
        });
      const { expectedRevision: _, ...content } = data;
      const saved: DashboardDataset = {
        ...content,
        agentId,
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: Date.now(),
      };
      // Reject structural or value changes that would break any referencing widget.
      const next = [
        ...datasets.filter((dataset) => dataset.key !== data.key),
        saved,
      ];
      for (const row of db
        .prepare("SELECT blocks FROM dashboards WHERE agentId=?")
        .all(agentId))
        validateReferences(
          Schema.decodeUnknownSync(Schema.Array(DashboardBlock))(
            JSON.parse(String(row.blocks)),
          ).filter(
            (block) =>
              block.type === "dataset-chart" && block.datasetKey === data.key,
          ),
          next,
        );
      db.prepare(
        "INSERT INTO dashboard_datasets(agentId,key,content,revision,updatedAt) VALUES(?,?,?,?,?) ON CONFLICT(agentId,key) DO UPDATE SET content=excluded.content,revision=excluded.revision,updatedAt=excluded.updatedAt",
      ).run(
        agentId,
        data.key,
        JSON.stringify(content),
        saved.revision,
        saved.updatedAt,
      );
      return saved;
    }),
  );

export const deleteDataset = (agentId: string, input: DeleteDashboard) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      requireEnabled(db);
      requireAgent(db, agentId);
      const data = Schema.decodeUnknownSync(DeleteDashboard)(input);
      const existing = db
        .prepare(
          "SELECT revision FROM dashboard_datasets WHERE agentId=? AND key=?",
        )
        .get(agentId, data.key);
      if (!existing || existing.revision !== data.expectedRevision)
        throw new AgentStoreError({
          message:
            "This data source changed. Read it again before removing it.",
        });
      for (const row of db
        .prepare("SELECT blocks FROM dashboards WHERE agentId=?")
        .all(agentId)) {
        const blocks = Schema.decodeUnknownSync(Schema.Array(DashboardBlock))(
          JSON.parse(String(row.blocks)),
        );
        if (
          blocks.some(
            (block) =>
              block.type === "dataset-chart" && block.datasetKey === data.key,
          )
        )
          throw new AgentStoreError({
            message:
              "This data source is used by a chart. Remove its chart references first.",
          });
      }
      db.prepare(
        "DELETE FROM dashboard_datasets WHERE agentId=? AND key=?",
      ).run(agentId, data.key);
      return { removed: true };
    }),
  );
