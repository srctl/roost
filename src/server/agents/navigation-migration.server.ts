import type { DatabaseSync } from "node:sqlite";

export class AgentNavigationMigrationError extends Error {}

// This feature owns its version independently of core and the notes integration.
export function migrateAgentNavigation(db: DatabaseSync) {
  const version = () =>
    Number(
      db.prepare("SELECT MAX(version) v FROM agent_navigation_versions").get()
        ?.v ?? 0,
    );
  const assertVersion = (current: number) => {
    if (current > 1)
      throw new AgentNavigationMigrationError(
        "Agent navigation needs a newer version of Roost.",
      );
    return current === 1;
  };
  // Reads of an upgraded store must not acquire a write lock.
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_navigation_versions'",
      )
      .get() &&
    assertVersion(version())
  )
    return;
  // Composes with the core14 integration's outer transaction. The DDL obtains
  // the write lock before rechecking the version for simultaneous first opens.
  db.exec("SAVEPOINT agent_navigation_upgrade");
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS agent_navigation_versions (version INTEGER PRIMARY KEY)",
    );
    if (!assertVersion(version()))
      db.exec(`
      CREATE TABLE agent_navigation_sections (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
        collapsed INTEGER NOT NULL DEFAULT 0 CHECK(collapsed IN (0,1))
      );
      CREATE TABLE agent_navigation_memberships (
        agentId TEXT PRIMARY KEY, sectionId TEXT NOT NULL
      );
      CREATE INDEX agent_navigation_memberships_section ON agent_navigation_memberships(sectionId);
      INSERT INTO agent_navigation_versions VALUES(1);
    `);
    db.exec("RELEASE agent_navigation_upgrade");
  } catch (error) {
    db.exec(
      "ROLLBACK TO agent_navigation_upgrade; RELEASE agent_navigation_upgrade",
    );
    throw error;
  }
}
