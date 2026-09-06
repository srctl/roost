import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { Automation, AutomationInput } from "../../features/automations/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { putMessage } from "../runs/timeline.server";
import { nextOccurrence, scheduleLabel } from "./schedule";
import type { DatabaseSync } from "node:sqlite";

export function readAutomations(
  db: DatabaseSync,
  agentId?: string,
): Automation[] {
  const rows = agentId
    ? db
        .prepare(
          "SELECT * FROM automations WHERE agentId = ? ORDER BY rowid DESC",
        )
        .all(agentId)
    : db.prepare("SELECT * FROM automations").all();
  return rows.map((row) =>
    Schema.decodeUnknownSync(Automation)({
      ...row,
      enabled: !!row.enabled,
      schedule: JSON.parse(String(row.schedule)),
    }),
  );
}
export const listAutomations = (agentId: string) =>
  withAgentStore((db) => readAutomations(db, agentId));
export function requireAgent(db: DatabaseSync, id: string) {
  if (!db.prepare("SELECT id FROM agents WHERE id = ?").get(id))
    throw new AgentStoreError({ message: "Agent not found." });
}
export const saveAutomation = (
  input: AutomationInput,
  expectedRevision?: number,
) =>
  withAgentStore((db) => {
    const decoded = Schema.decodeUnknownSync(AutomationInput)(input);
    const data = {
      ...decoded,
      schedule: {
        ...decoded.schedule,
        timezone:
          decoded.schedule.timezone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };
    requireAgent(db, data.agentId);
    db.exec("BEGIN IMMEDIATE");
    try {
      const owner = db
        .prepare("SELECT agentId FROM automations WHERE id=?")
        .get(data.id);
      if (owner && owner.agentId !== data.agentId)
        throw new AgentStoreError({
          message: "This automation ID has already been used.",
        });
      const current = readAutomations(db, data.agentId).find(
        (a) => a.id === data.id,
      );
      if (current && expectedRevision === undefined) {
        if (
          current.name === data.name &&
          current.prompt === data.prompt &&
          current.notification === data.notification &&
          JSON.stringify(current.schedule) === JSON.stringify(data.schedule)
        ) {
          db.exec("COMMIT");
          return current;
        }
        throw new AgentStoreError({
          message: "This automation already exists. Reload before editing.",
        });
      }
      if (
        expectedRevision !== undefined &&
        (!current || current.revision !== expectedRevision)
      )
        throw new AgentStoreError({
          message: "This automation changed. Reload before saving.",
        });
      let next: number | null;
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: data.schedule.timezone });
        next = nextOccurrence(data.schedule, Date.now());
      } catch {
        throw new AgentStoreError({
          message:
            "Choose a valid schedule and IANA timezone, such as America/Los_Angeles.",
        });
      }
      if (!next)
        throw new AgentStoreError({ message: "Choose a future run time." });
      const revision = (current?.revision ?? 0) + 1;
      db.prepare(
        "INSERT INTO automations (id, agentId, name, prompt, schedule, notification, revision, enabled, nextRunAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,prompt=excluded.prompt,schedule=excluded.schedule,notification=excluded.notification,revision=excluded.revision,nextRunAt=excluded.nextRunAt WHERE automations.agentId=excluded.agentId",
      ).run(
        data.id,
        data.agentId,
        data.name,
        data.prompt,
        JSON.stringify(data.schedule),
        data.notification,
        revision,
        current ? Number(current.enabled) : 1,
        current?.enabled === false ? null : next,
      );
      // Queued work uses the old saved prompt; cancel it when the commitment changes.
      db.prepare(
        "UPDATE runs SET status='cancelled', finishedAt=? WHERE automationId=? AND status='queued'",
      ).run(Date.now(), data.id);
      putMessage(db, data.agentId, {
        id: randomUUID(),
        role: "notice",
        noticeKind: "automation",
        referenceId: data.id,
        title: current ? "Automation updated" : "Automation created",
        text: `${data.name} · ${scheduleLabel(data.schedule)} · ${data.notification === "always" ? "Report every run" : "Only notify when needed"}`,
      });
      db.exec("COMMIT");
      return {
        ...data,
        revision,
        enabled: current?.enabled ?? true,
        nextRunAt: current?.enabled === false ? null : next,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
export const toggleAutomation = (
  agentId: string,
  id: string,
  revision: number,
  enabled: boolean,
) =>
  withAgentStore((db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const automation = readAutomations(db, agentId).find((a) => a.id === id);
      if (!automation || automation.revision !== revision)
        throw new AgentStoreError({
          message: "This automation changed. Reload before updating.",
        });
      const next = enabled
        ? nextOccurrence(automation.schedule, Date.now())
        : null;
      if (enabled && !next)
        throw new AgentStoreError({
          message: "Edit this one-time automation to choose a future date.",
        });
      db.prepare(
        "UPDATE automations SET enabled=?, nextRunAt=?, revision=revision+1 WHERE id=?",
      ).run(Number(enabled), next, id);
      if (!enabled)
        db.prepare(
          "UPDATE runs SET status='cancelled', finishedAt=? WHERE automationId=? AND status='queued'",
        ).run(Date.now(), id);
      putMessage(db, agentId, {
        id: randomUUID(),
        role: "notice",
        noticeKind: "automation",
        referenceId: id,
        title: enabled ? "Automation resumed" : "Automation paused",
        text: automation.name,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
