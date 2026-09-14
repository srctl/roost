import type { DatabaseSync } from "node:sqlite";
import {
  assertDeletionShape,
  FeatureMigrationError,
} from "./feature-migration.server";

// One ownership contract for deletion and late-write fences. Shared profiles,
// sections and native thread metadata are deliberately retained.
export const agentOwnedTables = [
  "conversations",
  "agent_sessions",
  "conversation_records",
  "conversation_sessions",
  "provider_message_ids",
  "timeline",
  "timeline_imports",
  "soul_changes",
  "automations",
  "runs",
  "files",
  "approvals",
  "dashboards",
  "dashboard_datasets",
  "agent_notifications",
  "agent_reflections",
  "agent_notes",
  "note_revisions",
  "note_requests",
  "note_reads",
  "agent_navigation_memberships",
  "coding_settings",
  "coding_jobs",
  "coding_job_inputs",
  "coding_job_updates",
  "coding_job_workspaces",
  "coding_job_feedback",
  "coding_worker_messages",
  "coding_worker_fences",
] as const;

// Feature-keyed: PR12 originally used core11, now owned by Threads/Notes.
// Runs inside the core upgrade transaction, after all owned tables exist.
export function migrateAgentDeletion(db: DatabaseSync) {
  assertDeletionShape(db);
  db.exec(
    "CREATE TABLE IF NOT EXISTS agent_deletion_versions (version INTEGER PRIMARY KEY)",
  );
  const version = Number(
    db.prepare("SELECT MAX(version) v FROM agent_deletion_versions").get()?.v ??
      0,
  );
  if (version > 1)
    throw new FeatureMigrationError(
      "Agent deletion needs a newer version of Roost.",
    );
  if (version === 1) return;
  db.exec(
    "CREATE TABLE IF NOT EXISTS deleted_agents (id TEXT PRIMARY KEY, deletedAt INTEGER NOT NULL)",
  );
  for (const [table, columns] of [
    ["agents", ["id"]],
    ...agentOwnedTables.map((table) => [table, ["agentId"]] as const),
    ["delegations", ["sourceAgentId", "targetAgentId"]],
  ] as const) {
    for (const operation of ["INSERT", "UPDATE"]) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS deleted_${table}_${operation}
        BEFORE ${operation} ON ${table}
        WHEN ${columns.map((column) => `EXISTS (SELECT 1 FROM deleted_agents WHERE id=NEW.${column})`).join(" OR ")}
        BEGIN SELECT RAISE(ABORT, 'Agent was deleted.'); END`);
    }
  }
  db.exec("INSERT INTO agent_deletion_versions VALUES(1)");
}
