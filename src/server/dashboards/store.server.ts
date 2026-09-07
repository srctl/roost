import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import {
  DashboardWidget,
  DeleteDashboard,
  SaveDashboard,
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

export const listDashboards = (agentId?: string) =>
  withAgentStore((db) => {
    requireEnabled(db);
    if (agentId) requireAgent(db, agentId);
    const rows = agentId
      ? db
          .prepare(
            "SELECT * FROM dashboards WHERE agentId=? ORDER BY updatedAt DESC,key",
          )
          .all(agentId)
      : db
          .prepare(
            "SELECT * FROM dashboards ORDER BY updatedAt DESC,agentId,key",
          )
          .all();
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
