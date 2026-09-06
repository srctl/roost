import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Data, Effect, Schema } from "effect";
import { Agent, CreateAgentInput } from "../../features/agents/schema";

export class AgentStoreError extends Data.TaggedError("AgentStoreError")<{
  message: string;
}> {}

export function withAgentStore<A>(
  run: (db: DatabaseSync, directory: string) => A,
  directory = resolve(process.env.ROOST_DATA_DIR ?? ".roost"),
) {
  return Effect.try({
    try: () => {
      mkdirSync(directory, { recursive: true });
      const db = new DatabaseSync(join(directory, "roost.sqlite"));
      try {
        db.exec("PRAGMA busy_timeout = 5000");
        const version = Number(
          db.prepare("PRAGMA user_version").get()?.user_version,
        );
        if (version > 1)
          throw new AgentStoreError({
            message: "This database needs a newer version of Roost.",
          });
        if (version === 0) {
          db.exec("BEGIN IMMEDIATE");
          try {
            db.exec(`
          CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, instructions TEXT NOT NULL,
            character TEXT NOT NULL, model TEXT NOT NULL, createdAt TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS conversation_instructions (
            threadId TEXT PRIMARY KEY, instructions TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS conversations (
            agentId TEXT PRIMARY KEY, threadId TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS agent_sessions (
            agentId TEXT PRIMARY KEY, threadId TEXT NOT NULL, archive TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS thread_context (threadId TEXT PRIMARY KEY, position INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS agent_tool_versions (threadId TEXT PRIMARY KEY, version INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS timeline (
            position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            agentId TEXT NOT NULL, message TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS timeline_imports (agentId TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS soul_changes (
            id TEXT PRIMARY KEY, agentId TEXT NOT NULL, source TEXT NOT NULL,
            reason TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL,
            beforeRevision TEXT NOT NULL, afterRevision TEXT NOT NULL, createdAt TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS automations (
            id TEXT PRIMARY KEY, agentId TEXT NOT NULL, name TEXT NOT NULL,
            prompt TEXT NOT NULL, schedule TEXT NOT NULL, notification TEXT NOT NULL,
            revision INTEGER NOT NULL, enabled INTEGER NOT NULL, nextRunAt INTEGER
          );
          CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY, agentId TEXT NOT NULL, kind TEXT NOT NULL,
            prompt TEXT NOT NULL, status TEXT NOT NULL, automationId TEXT,
            scheduledFor INTEGER, createdAt INTEGER NOT NULL, startedAt INTEGER,
            finishedAt INTEGER, messages TEXT NOT NULL DEFAULT '[]', error TEXT,
            threadId TEXT, soulRevision TEXT, owner TEXT, cancelRequested INTEGER NOT NULL DEFAULT 0,
            automationSnapshot TEXT,
            UNIQUE (automationId, scheduledFor)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS one_agent_run ON runs(agentId) WHERE status = 'running';
          CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY, owner TEXT NOT NULL, heartbeat INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS runtime_control (id INTEGER PRIMARY KEY, maintenance INTEGER NOT NULL DEFAULT 0);
          INSERT OR IGNORE INTO runtime_control (id,maintenance) VALUES (1,0);
          PRAGMA user_version = 1;
          `);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        }
        return run(db, directory);
      } finally {
        db.close();
      }
    },
    catch: (error) =>
      error instanceof AgentStoreError
        ? error
        : new AgentStoreError({
            message:
              "Could not access agent storage. Check the Roost data directory permissions.",
          }),
  });
}

export const listAgents = (directory?: string) =>
  withAgentStore(
    (db) =>
      Schema.decodeUnknownSync(Schema.Array(Agent))(
        db.prepare("SELECT * FROM agents ORDER BY createdAt, id").all(),
      ),
    directory,
  );

export const saveAgent = (input: CreateAgentInput, directory?: string) =>
  withAgentStore((db, root) => {
    const data = Schema.decodeUnknownSync(CreateAgentInput)(input);
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db
        .prepare("SELECT * FROM agents WHERE id = ?")
        .get(data.id);
      if (existing) {
        const agent = Schema.decodeUnknownSync(Agent)(existing);
        if (
          agent.name !== data.name ||
          agent.instructions !== data.instructions ||
          agent.character !== data.character ||
          agent.model !== data.model
        ) {
          throw new AgentStoreError({
            message:
              "This creation request was already used. Reload the form to create another agent.",
          });
        }
        db.exec("COMMIT");
        return agent;
      }
      const agent = { ...data, createdAt: new Date().toISOString() };
      mkdirSync(join(root, "workspaces", agent.id), { recursive: true });
      db.prepare(
        "INSERT INTO agents (id, name, instructions, character, model, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        agent.id,
        agent.name,
        agent.instructions,
        agent.character,
        agent.model,
        agent.createdAt,
      );
      db.exec("COMMIT");
      return agent;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }, directory);

export const getAgentConversation = (id: string) =>
  withAgentStore((db, root) => {
    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
    if (!agent) throw new AgentStoreError({ message: "Agent not found." });
    const session = db
      .prepare(
        "SELECT s.threadId, s.archive, i.instructions FROM agent_sessions s LEFT JOIN conversation_instructions i ON i.threadId = s.threadId WHERE s.agentId = ?",
      )
      .get(id);
    const row = db
      .prepare("SELECT threadId FROM conversations WHERE agentId = ?")
      .get(id);
    return {
      agent: Schema.decodeUnknownSync(Agent)(agent),
      workspace: join(root, "workspaces", id),
      codexHome: join(root, "agents", id, "codex"),
      soulPath: join(root, "agents", id, "SOUL.md"),
      threadId: session ? String(session.threadId) : null,
      toolVersion: session
        ? Number(
            db
              .prepare(
                "SELECT version FROM agent_tool_versions WHERE threadId=?",
              )
              .get(String(session.threadId))?.version ?? 0,
          )
        : 0,
      legacyThreadId: !session && row ? String(row.threadId) : null,
      archive: session ? String(session.archive) : "[]",
      appliedInstructions:
        typeof session?.instructions === "string" ? session.instructions : null,
    };
  });
export const saveConversationThread = (
  agentId: string,
  threadId: string,
  archive = "[]",
) =>
  withAgentStore((db) => {
    db.prepare(
      "INSERT INTO agent_sessions (agentId, threadId, archive) VALUES (?, ?, ?) ON CONFLICT(agentId) DO UPDATE SET threadId=excluded.threadId,archive=excluded.archive",
    ).run(agentId, threadId, archive);
    db.prepare(
      "INSERT OR REPLACE INTO agent_tool_versions (threadId,version) VALUES (?,3)",
    ).run(threadId);
  });

export const saveConversationInstructions = (
  threadId: string,
  instructions: string,
) =>
  withAgentStore((db) => {
    db.prepare(
      "INSERT INTO conversation_instructions (threadId, instructions) VALUES (?, ?) ON CONFLICT(threadId) DO UPDATE SET instructions = excluded.instructions",
    ).run(threadId, instructions);
  });
