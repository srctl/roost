import { withAgentStore } from "./store.server";

export type AgentActivity = "working" | "queued" | "delegating";

export const readAgentActivity = () =>
  withAgentStore((db) => {
    const activity: Record<string, AgentActivity> = {};
    for (const row of db
      .prepare(
        "SELECT DISTINCT d.sourceAgentId FROM delegations d JOIN runs r ON r.id=d.id WHERE r.status IN ('queued','running')",
      )
      .all())
      activity[String(row.sourceAgentId)] = "delegating";
    for (const row of db
      .prepare(
        "SELECT agentId,status FROM runs WHERE status IN ('queued','running') ORDER BY CASE status WHEN 'running' THEN 1 ELSE 0 END",
      )
      .all())
      activity[String(row.agentId)] =
        row.status === "running" ? "working" : "queued";

    return activity;
  });
