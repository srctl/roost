-- Historical Threads migration from the prepared main merge stage.
BEGIN IMMEDIATE;
          ALTER TABLE conversation_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex';
          ALTER TABLE conversation_sessions ADD COLUMN model TEXT;
          UPDATE conversation_sessions SET model=(SELECT model FROM agents WHERE agents.id=conversation_sessions.agentId);
          PRAGMA user_version=12;
          COMMIT;
