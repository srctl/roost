import { DatabaseSync } from "node:sqlite";

export class FeatureMigrationError extends Error {}

const notes = `
CREATE TABLE agent_notes (agentId TEXT PRIMARY KEY, revision INTEGER NOT NULL, blocks TEXT NOT NULL, instructions TEXT NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE note_revisions (agentId TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(agentId,revision));
CREATE TABLE note_requests (agentId TEXT NOT NULL, requestId TEXT NOT NULL, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(agentId,requestId));
CREATE TABLE note_reads (token TEXT PRIMARY KEY, agentId TEXT NOT NULL, scope TEXT NOT NULL, revision INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
`;
const threads = `
CREATE TABLE timeline(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL,agentId TEXT NOT NULL,conversationId TEXT NOT NULL,message TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,createdAt INTEGER NOT NULL DEFAULT 0,UNIQUE(agentId,conversationId,id));
CREATE TABLE conversation_records (id TEXT PRIMARY KEY, agentId TEXT NOT NULL, parentConversationId TEXT, parentMessageId TEXT, parent TEXT, createdAt INTEGER NOT NULL, deletedAt INTEGER, UNIQUE(agentId,parentConversationId,parentMessageId));
CREATE TABLE conversation_sessions (conversationId TEXT PRIMARY KEY, agentId TEXT NOT NULL, threadId TEXT NOT NULL, archive TEXT NOT NULL);
CREATE TABLE provider_message_ids(agentId TEXT NOT NULL,conversationId TEXT NOT NULL,threadId TEXT NOT NULL,nativeId TEXT NOT NULL,messageId TEXT NOT NULL,PRIMARY KEY(agentId,conversationId,threadId,nativeId));
`;

// Compare the contracts used by SQL writers (including ordered columns and keys),
// not just a numeric version: Notes and Threads independently shipped v11.
export function inspectFeatureShape(db: DatabaseSync, version: number) {
  const exists = (name: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);
  const columns = (connection: DatabaseSync, name: string) =>
    connection.prepare(`PRAGMA table_info("${name}")`).all();
  const has = (name: string, column: string) =>
    columns(db, name).some((row) => row.name === column);
  const fail = (name: string): never => {
    throw new FeatureMigrationError(
      `Unsupported database shape (${name}). Storage was left unchanged.`,
    );
  };
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec(notes + threads);
    const signature = (connection: DatabaseSync, name: string) =>
      JSON.stringify(
        columns(connection, name).map(({ name, type, notnull, pk }) => ({
          name,
          type,
          notnull,
          pk,
        })),
      );
    const validate = (name: string) => {
      if (signature(db, name) !== signature(reference, name)) fail(name);
      const keys = (connection: DatabaseSync) =>
        connection
          .prepare(`PRAGMA index_list("${name}")`)
          .all()
          .filter((index) => index.unique === 1)
          .map((index) =>
            JSON.stringify(
              connection
                .prepare(
                  `PRAGMA index_info("${String(index.name).replaceAll('"', '""')}")`,
                )
                .all()
                .map((column) => column.name),
            ),
          )
          .sort();
      if (JSON.stringify(keys(db)) !== JSON.stringify(keys(reference)))
        fail(`${name} keys`);
    };
    const noteTables = [
      "agent_notes",
      "note_revisions",
      "note_requests",
      "note_reads",
    ];
    const noteCount = noteTables.filter(exists).length;
    if (noteCount !== 0 && noteCount !== noteTables.length)
      fail("partial Notes");
    if (noteCount) for (const table of noteTables) validate(table);
    const threadParts = [
      exists("conversation_records"),
      exists("conversation_sessions"),
      has("runs", "conversationId"),
      has("timeline", "conversationId"),
    ];
    const threadsPresent = threadParts.every(Boolean);
    if (threadParts.some(Boolean) && !threadsPresent) fail("partial Threads");
    const provider = has("conversation_sessions", "provider");
    const model = has("conversation_sessions", "model");
    if (provider !== model) fail("partial session provider/model");
    const messageIds = exists("provider_message_ids");
    if (messageIds && (!threadsPresent || !provider))
      fail("orphan provider mappings");
    if (threadsPresent) {
      if (provider)
        reference.exec(
          "ALTER TABLE conversation_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex'; ALTER TABLE conversation_sessions ADD COLUMN model TEXT",
        );
      validate("conversation_records");
      validate("conversation_sessions");
      validate("timeline");
      if (!exists("runs_main_conversation")) fail("run ownership trigger");
    }
    if (messageIds) validate("provider_message_ids");
    if (version >= 11 && !threadsPresent && !noteCount)
      fail("missing v11 features");
    if (version >= 12 && (!threadsPresent || !provider))
      fail("missing v12 sessions");
    if (version >= 13 && !messageIds) fail("missing v13 mappings");
    if (version >= 14 && !noteCount) fail("missing v14 Notes");
    return { threads: threadsPresent, sessionModels: provider, messageIds };
  } finally {
    reference.close();
  }
}

export function migrateNotes(db: DatabaseSync) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_notes'").get())
    db.exec(notes);
}
