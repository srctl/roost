import type { DatabaseSync } from "node:sqlite";

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
    ) > 1
  )
    throw new Error("This job workspace needs a newer version of Roost.");
  if (
    db
      .prepare("SELECT version FROM coding_workspace_versions WHERE version=1")
      .get()
  )
    return;
  db.exec("BEGIN IMMEDIATE");
  try {
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
      COMMIT;
    `);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
