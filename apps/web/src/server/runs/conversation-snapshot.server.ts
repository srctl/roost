import { withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import { requireConversation, threadSummaries } from "./threads.server";
import { readTimelinePage } from "./timeline.server";

// Read only Roost's saved state. SSR must not start a worker, import a legacy
// Codex thread, or contact a provider before it can show the conversation.
export const readConversationSnapshot = (
  agentId: string,
  options: { since?: number; before?: number; conversationId?: string } = {},
  directory?: string,
) =>
  withAgentStore((db) => {
    assertAvailable(db);
    requireConversation(db, agentId, options.conversationId);
    const page = readTimelinePage(db, agentId, options);
    const run = db
      .prepare(
        "SELECT id FROM runs WHERE agentId=? AND conversationId=? AND status IN ('running','queued') ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,createdAt LIMIT 1",
      )
      .get(agentId, options.conversationId ?? agentId);
    const computer = run
      ? db
          .prepare(
            "SELECT id FROM timeline WHERE agentId=? AND conversationId=? AND position>(SELECT position FROM timeline WHERE agentId=? AND id=?) AND json_extract(message,'$.title')='roost_computer' ORDER BY position DESC LIMIT 1",
          )
          .get(
            agentId,
            options.conversationId ?? agentId,
            agentId,
            String(run.id),
          )
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
      job: db
        .prepare("SELECT id,title FROM coding_jobs WHERE id=? AND agentId=?")
        .get(options.conversationId ?? agentId, agentId) as
        | { id: string; title: string }
        | undefined,
      conversationId: options.conversationId ?? agentId,
      threads: threadSummaries(db, agentId),
      active: db
        .prepare(
          "SELECT id,conversationId,status FROM runs WHERE agentId=? AND status='running'",
        )
        .get(agentId) as
        | { id: string; conversationId: string; status: string }
        | undefined,
      status: run
        ? String(
            db
              .prepare("SELECT status FROM runs WHERE id=?")
              .get(String(run.id))!.status,
          )
        : null,
      busy: !!run,
      runId: run ? String(run.id) : null,
      computerAnchor: computer ? String(computer.id) : null,
      needsImport,
    };
  }, directory);
