import type { DatabaseSync } from "node:sqlite";

export class CodingWorkspaceMigrationError extends Error {}

// Additive, feature-keyed migration: the unmerged thread and note stacks own
// numeric migrations after core v10. Do not consume or imitate those versions.
export function migrateCodingWorkspace(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS coding_workspace_versions (version INTEGER PRIMARY KEY)`,
  );
  if (
    Number(
      db
        .prepare(
          "SELECT MAX(version) AS version FROM coding_workspace_versions",
        )
        .get()?.version ?? 0,
    ) > 2
  )
    throw new CodingWorkspaceMigrationError(
      "This job workspace needs a newer version of Roost.",
    );
  const version = Number(
    db
      .prepare("SELECT MAX(version) AS version FROM coding_workspace_versions")
      .get()?.version ?? 0,
  );
  if (version >= 2) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (version < 1)
      db.exec(`
      CREATE TABLE IF NOT EXISTS coding_job_workspaces (
        jobId TEXT PRIMARY KEY, agentId TEXT NOT NULL, conversationId TEXT NOT NULL,
        data TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coding_job_feedback (
        messageId TEXT PRIMARY KEY, jobId TEXT NOT NULL, agentId TEXT NOT NULL,
        previewRevision TEXT NOT NULL, createdAt INTEGER NOT NULL, inputId TEXT
      );
      CREATE INDEX IF NOT EXISTS coding_feedback_job ON coding_job_feedback(jobId,createdAt);
      INSERT OR IGNORE INTO coding_workspace_versions VALUES(1);
    `);
    if (
      db
        .prepare(
          "SELECT r.id FROM runs r JOIN coding_job_updates u ON u.runId=r.id WHERE r.status='running' AND r.conversationId!=u.jobId",
        )
        .get()
    )
      throw new CodingWorkspaceMigrationError(
        "Finish or stop active coding report turns before upgrading job discussions.",
      );
    db.exec(`
      INSERT INTO conversation_records(id,agentId,createdAt)
        SELECT id,agentId,createdAt FROM coding_jobs;
      UPDATE timeline SET conversationId=(SELECT f.jobId FROM coding_job_feedback f WHERE f.messageId=timeline.id AND f.agentId=timeline.agentId)
        WHERE conversationId=agentId AND EXISTS(SELECT 1 FROM coding_job_feedback f WHERE f.messageId=timeline.id AND f.agentId=timeline.agentId);
      UPDATE timeline SET conversationId=(SELECT u.jobId FROM coding_job_updates u JOIN runs r ON r.id=u.runId WHERE u.runId=timeline.id AND u.agentId=timeline.agentId AND r.status='queued')
        WHERE EXISTS(SELECT 1 FROM coding_job_updates u JOIN runs r ON r.id=u.runId WHERE u.runId=timeline.id AND u.agentId=timeline.agentId AND r.status='queued');
      UPDATE runs SET conversationId=(SELECT jobId FROM coding_job_updates WHERE runId=runs.id) WHERE status='queued' AND EXISTS(SELECT 1 FROM coding_job_updates WHERE runId=runs.id);
      UPDATE coding_job_workspaces SET conversationId=jobId;
      INSERT INTO coding_workspace_versions VALUES(2);
      COMMIT;
    `);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
