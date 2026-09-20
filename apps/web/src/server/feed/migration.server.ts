import type { DatabaseSync } from "node:sqlite";

export function migrateFeed(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feed_items (
      position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      dedupeKey TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
      content TEXT NOT NULL, sourceId TEXT, authorAgentId TEXT,
      createdAt INTEGER NOT NULL, publishedAt INTEGER NOT NULL,
      score REAL NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1,
      readAt INTEGER, saved INTEGER NOT NULL DEFAULT 0,
      dismissed INTEGER NOT NULL DEFAULT 0, feedback INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS feed_items_visible ON feed_items(visible, dismissed, position DESC);
    CREATE INDEX IF NOT EXISTS feed_items_published ON feed_items(publishedAt DESC, position DESC);
    CREATE TABLE IF NOT EXISTS feed_source_state (
      sourceId TEXT PRIMARY KEY, url TEXT NOT NULL, etag TEXT, lastModified TEXT,
      lastFetchedAt INTEGER, error TEXT
    );
    CREATE TABLE IF NOT EXISTS feed_refresh (
      id INTEGER PRIMARY KEY CHECK(id=1), requested INTEGER NOT NULL DEFAULT 0,
      nextAt INTEGER NOT NULL DEFAULT 0, owner TEXT, leaseUntil INTEGER,
      lastRefreshedAt INTEGER, lastError TEXT, curationAt INTEGER,
      curationRunId TEXT
    );
    INSERT OR IGNORE INTO feed_refresh(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS feed_publications (
      requestId TEXT PRIMARY KEY, agentId TEXT NOT NULL, itemId TEXT NOT NULL,
      fingerprint TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feed_scores (
      cacheKey TEXT PRIMARY KEY, value TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feed_discussions (
      requestId TEXT PRIMARY KEY, itemId TEXT NOT NULL, agentId TEXT NOT NULL,
      conversationId TEXT NOT NULL
    );
  `);
}

// Also run for stores whose agent-deletion migration was already applied.
export function migrateFeedDeletion(db: DatabaseSync) {
  for (const table of ["feed_publications", "feed_discussions"]) {
    for (const operation of ["INSERT", "UPDATE"]) {
      db.exec(`CREATE TRIGGER IF NOT EXISTS deleted_${table}_${operation}
        BEFORE ${operation} ON ${table}
        WHEN EXISTS (SELECT 1 FROM deleted_agents WHERE id=NEW.agentId)
        BEGIN SELECT RAISE(ABORT, 'Agent was deleted.'); END`);
    }
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS feed_deleted_editor AFTER DELETE ON agents
    BEGIN
      UPDATE feed_settings SET revision=revision+1,
        value=json_set(value,'$.agentId',NULL,'$.emailEnabled',json('false'))
        WHERE json_extract(value,'$.agentId')=OLD.id;
    END`);
}
