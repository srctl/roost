import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
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
        if (version > 10)
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
        if (version < 2) {
          db.exec(`BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS delegations (
              id TEXT PRIMARY KEY, sourceAgentId TEXT NOT NULL,
              sourceRunId TEXT NOT NULL, targetAgentId TEXT NOT NULL,
              task TEXT NOT NULL, resultRunId TEXT UNIQUE
            );
            CREATE INDEX IF NOT EXISTS delegations_source ON delegations(sourceAgentId);
            PRAGMA user_version = 2;
            COMMIT;`);
        }
        if (version < 3) {
          db.exec(`BEGIN IMMEDIATE;
            ALTER TABLE timeline ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
            CREATE TABLE timeline_revision (id INTEGER PRIMARY KEY, value INTEGER NOT NULL);
            INSERT INTO timeline_revision VALUES (1, 0);
            CREATE INDEX timeline_agent_position ON timeline(agentId, position);
            CREATE INDEX timeline_agent_revision ON timeline(agentId, revision);
            CREATE INDEX runs_active_agent ON runs(agentId, status) WHERE status IN ('running','queued');
            CREATE TRIGGER timeline_insert_revision AFTER INSERT ON timeline BEGIN
              UPDATE timeline_revision SET value=value+1 WHERE id=1;
              UPDATE timeline SET revision=(SELECT value FROM timeline_revision WHERE id=1) WHERE position=NEW.position;
            END;
            CREATE TRIGGER timeline_update_revision AFTER UPDATE OF message ON timeline WHEN OLD.message != NEW.message BEGIN
              UPDATE timeline_revision SET value=value+1 WHERE id=1;
              UPDATE timeline SET revision=(SELECT value FROM timeline_revision WHERE id=1) WHERE position=NEW.position;
            END;
            PRAGMA user_version = 3;
            COMMIT;`);
        }
        if (version < 4) {
          db.exec(`BEGIN IMMEDIATE;
            CREATE TABLE files (
              id TEXT PRIMARY KEY, agentId TEXT NOT NULL, runId TEXT,
              name TEXT NOT NULL, mimeType TEXT NOT NULL, size INTEGER NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('attachment','artifact')), createdAt INTEGER NOT NULL
            );
            CREATE INDEX files_agent_run ON files(agentId,runId);
            CREATE TABLE approvals (
              id TEXT PRIMARY KEY, agentId TEXT NOT NULL, runId TEXT NOT NULL,
              threadId TEXT NOT NULL, requestKey TEXT NOT NULL, request TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending', response TEXT,
              createdAt INTEGER NOT NULL, resolvedAt INTEGER,
              UNIQUE(runId,requestKey)
            );
            CREATE INDEX approvals_agent_status ON approvals(agentId,status);
            CREATE TABLE push_subscriptions (
              endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL, createdAt INTEGER NOT NULL
            );
            PRAGMA user_version = 4;
            COMMIT;`);
        }
        if (version < 5) {
          db.exec(`BEGIN IMMEDIATE;
            CREATE TABLE dashboard_settings (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0);
            INSERT INTO dashboard_settings(id,enabled) VALUES(1,0);
            CREATE TABLE dashboards (
              agentId TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL,
              blocks TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
              PRIMARY KEY(agentId,key)
            );
            PRAGMA user_version = 5;
            COMMIT;`);
        }
        if (version < 6) {
          db.exec(`BEGIN IMMEDIATE;
            CREATE TABLE notification_settings (id INTEGER PRIMARY KEY CHECK(id=1), preferences TEXT NOT NULL);
            INSERT INTO notification_settings(id,preferences) VALUES(1,'{"enabled":true,"turnCompleted":true,"agentUpdates":true,"needsAttention":true}');
            CREATE TABLE agent_notifications (
              id TEXT PRIMARY KEY, agentId TEXT NOT NULL, runId TEXT NOT NULL,
              requestId TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
              createdAt INTEGER NOT NULL, UNIQUE(agentId,requestId)
            );
            ALTER TABLE runs ADD COLUMN hasAgentUpdate INTEGER NOT NULL DEFAULT 0;
            PRAGMA user_version = 6;
            COMMIT;`);
        }
        if (version < 7) {
          db.exec(`BEGIN IMMEDIATE;
            CREATE TABLE agent_reflections (
              agentId TEXT PRIMARY KEY, intervalMinutes INTEGER NOT NULL DEFAULT 360,
              nextRunAt INTEGER, lastActivityAt INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX runs_agent_kind_finished ON runs(agentId,kind,finishedAt);
            PRAGMA user_version = 7;
            COMMIT;`);
        }
        if (version < 8) {
          db.exec(`BEGIN IMMEDIATE;
            ALTER TABLE agents ADD COLUMN kind TEXT NOT NULL DEFAULT 'assistant' CHECK(kind IN ('assistant','coding'));
            CREATE TABLE coding_settings (
              agentId TEXT PRIMARY KEY, repository TEXT NOT NULL,
              projectInstructions TEXT NOT NULL, defaultProfileId TEXT,
              sources TEXT NOT NULL, revision INTEGER NOT NULL
            );
            CREATE TABLE coding_profiles (
              id TEXT PRIMARY KEY, name TEXT NOT NULL,
              kind TEXT NOT NULL CHECK(kind IN ('local','ssh')),
              target TEXT NOT NULL, instructions TEXT NOT NULL, revision INTEGER NOT NULL
            );
            CREATE TABLE coding_jobs (
              id TEXT PRIMARY KEY, agentId TEXT NOT NULL, title TEXT NOT NULL,
              brief TEXT NOT NULL, assignment TEXT NOT NULL DEFAULT '',
              profileId TEXT, sourceUrl TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('queued','starting','running','blocked','review','completed','failed','cancelled')),
              cwd TEXT NOT NULL, sessionName TEXT NOT NULL,
              workerName TEXT NOT NULL, workerKind TEXT NOT NULL,
              remoteTarget TEXT NOT NULL, repository TEXT NOT NULL,
              projectInstructions TEXT NOT NULL, profileInstructions TEXT NOT NULL,
              sourceRunId TEXT NOT NULL DEFAULT '', lastWorkerState TEXT NOT NULL DEFAULT '',
              observedWorking INTEGER NOT NULL DEFAULT 0, dispatchedAt INTEGER,
              notifiedStatus TEXT NOT NULL DEFAULT '', paneId TEXT NOT NULL DEFAULT '',
              sessionIdentity TEXT NOT NULL DEFAULT '', launchOwner TEXT NOT NULL DEFAULT '',
              nativeSessionId TEXT NOT NULL DEFAULT '',
              cancelRequested INTEGER NOT NULL DEFAULT 0, request TEXT NOT NULL,
              summary TEXT NOT NULL, error TEXT NOT NULL, output TEXT NOT NULL DEFAULT '',
              lastCheckedAt INTEGER NOT NULL DEFAULT 0,
              createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, revision INTEGER NOT NULL
            );
            CREATE INDEX coding_jobs_agent ON coding_jobs(agentId,createdAt DESC);
            CREATE INDEX coding_jobs_status ON coding_jobs(status);
            CREATE TABLE coding_job_inputs (
              id TEXT PRIMARY KEY, jobId TEXT NOT NULL, agentId TEXT NOT NULL,
              prompt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
              error TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL
            );
            CREATE INDEX coding_job_inputs_job ON coding_job_inputs(jobId,status,createdAt);
            CREATE TABLE coding_job_updates (
              runId TEXT PRIMARY KEY, jobId TEXT NOT NULL, agentId TEXT NOT NULL
            );
            PRAGMA user_version = 8;
            COMMIT;`);
        }
        if (version < 10) {
          // Both feature previews used schema 9. Complete either shape without
          // replacing saved datasets or an existing automation model selection.
          db.exec("BEGIN IMMEDIATE");
          try {
            db.exec(`CREATE TABLE IF NOT EXISTS dashboard_datasets (
              agentId TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL,
              revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
              PRIMARY KEY(agentId,key)
            )`);
            const columns = db.prepare("PRAGMA table_info(automations)").all();
            if (!columns.some((column) => column.name === "model"))
              db.exec("ALTER TABLE automations ADD COLUMN model TEXT");
            db.exec("PRAGMA user_version = 10; COMMIT");
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
          agent.model !== data.model ||
          agent.kind !== (data.kind ?? "assistant")
        ) {
          throw new AgentStoreError({
            message:
              "This creation request was already used. Reload the form to create another agent.",
          });
        }
        db.exec("COMMIT");

        return agent;
      }
      const agent = {
        ...data,
        kind: data.kind ?? "assistant",
        createdAt: new Date().toISOString(),
      };
      mkdirSync(join(root, "workspaces", agent.id), { recursive: true });
      db.prepare(
        "INSERT INTO agents (id, name, instructions, character, model, createdAt, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        agent.id,
        agent.name,
        agent.instructions,
        agent.character,
        agent.model,
        agent.createdAt,
        agent.kind,
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
      "INSERT OR REPLACE INTO agent_tool_versions (threadId,version) VALUES (?,12)",
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
