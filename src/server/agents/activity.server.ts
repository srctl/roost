import { withAgentStore } from "./store.server";

export type AgentActivity = "working" | "queued" | "delegating" | "approval";

export const readAgentActivity = () =>
  withAgentStore((db) => {
    const activity: Record<string, AgentActivity> = {};
    for (const row of db
      .prepare(
        "SELECT agentId,status FROM coding_jobs WHERE status IN ('queued','starting','running','blocked') ORDER BY CASE status WHEN 'blocked' THEN 1 ELSE 0 END",
      )
      .all())
      activity[String(row.agentId)] =
        row.status === "blocked" ? "approval" : "delegating";
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

    for (const row of db
      .prepare(
        "SELECT DISTINCT a.agentId FROM approvals a JOIN runs r ON r.id=a.runId WHERE a.status='pending' AND r.status='running' AND r.cancelRequested=0",
      )
      .all())
      activity[String(row.agentId)] = "approval";
    return activity;
  });
