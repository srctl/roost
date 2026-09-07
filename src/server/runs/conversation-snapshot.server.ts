import { withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { readTimelinePage } from "./timeline.server";

// Read only Roost's saved state. SSR must not start a worker, import a legacy
// Codex thread, or contact a provider before it can show the conversation.
export const readConversationSnapshot = (
  agentId: string,
  options: { since?: number; before?: number } = {},
  directory?: string,
) =>
  withAgentStore((db) => {
    assertAvailable(db);
    requireAgent(db, agentId);
    const page = readTimelinePage(db, agentId, options);
    const run = db
      .prepare(
        "SELECT id FROM runs WHERE agentId=? AND status IN ('running','queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,createdAt LIMIT 1",
      )
      .get(agentId);
    const computer = run
      ? db
          .prepare(
            "SELECT id FROM timeline WHERE agentId=? AND position>(SELECT position FROM timeline WHERE agentId=? AND id=?) AND json_extract(message,'$.title')='roost_computer' ORDER BY position DESC LIMIT 1",
          )
          .get(agentId, agentId, String(run.id))
      : undefined;
    const needsImport =
      !db
        .prepare("SELECT agentId FROM timeline_imports WHERE agentId=?")
        .get(agentId) &&
      !!db
        .prepare(
          "SELECT agentId FROM agent_sessions WHERE agentId=? UNION ALL SELECT agentId FROM conversations WHERE agentId=? LIMIT 1",
        )
        .get(agentId, agentId);

    return {
      ...page,
      busy: !!run,
      runId: run ? String(run.id) : null,
      computerAnchor: computer ? String(computer.id) : null,
      needsImport,
    };
  }, directory);
