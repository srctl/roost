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
    if (current > 3)
      throw new AgentNavigationMigrationError(
        "Agent navigation needs a newer version of Roost.",
      );
    return current === 3;
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
    assertVersion(version());
    if (version() < 1)
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
    if (version() < 2) {
      // Keep navigation order separate from creation order. Storing it on the
      // agent row also gives it the same deletion lifecycle as the agent.
      const columns = db.prepare("PRAGMA table_info(agents)").all();
      if (!columns.some((column) => column.name === "navigationPosition"))
        db.exec("ALTER TABLE agents ADD COLUMN navigationPosition INTEGER");
      db.exec("INSERT INTO agent_navigation_versions VALUES(2)");
    }
    if (version() < 3) {
      db.exec(
        "CREATE TABLE agent_navigation_layout (id INTEGER PRIMARY KEY CHECK(id=1), ungroupedPosition INTEGER NOT NULL)",
      );
      const sections = db
        .prepare(
          "SELECT id FROM agent_navigation_sections ORDER BY position,id",
        )
        .all();
      const update = db.prepare(
        "UPDATE agent_navigation_sections SET position=? WHERE id=?",
      );
      sections.forEach((section, position) => {
        update.run(position, String(section.id));
      });
      db.prepare("INSERT INTO agent_navigation_layout VALUES(1,?)").run(
        sections.length,
      );
      db.exec("INSERT INTO agent_navigation_versions VALUES(3)");
    }
    db.exec("RELEASE agent_navigation_upgrade");
  } catch (error) {
    db.exec(
      "ROLLBACK TO agent_navigation_upgrade; RELEASE agent_navigation_upgrade",
    );
    throw error;
  }
}
