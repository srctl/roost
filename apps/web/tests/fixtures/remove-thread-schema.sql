-- Test-only downgrade of a main-only fixture before replaying pre-thread migrations.
DROP TABLE provider_message_ids;
DROP TABLE conversation_sessions;
DROP TABLE conversation_records;
DROP TRIGGER runs_main_conversation;
ALTER TABLE runs DROP COLUMN conversationId;
DROP TRIGGER timeline_insert_revision;
DROP TRIGGER timeline_update_revision;
ALTER TABLE timeline RENAME TO timeline_threads;
CREATE TABLE timeline(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,agentId TEXT NOT NULL,message TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO timeline(position,id,agentId,message,revision) SELECT position,id,agentId,message,revision FROM timeline_threads;
DROP TABLE timeline_threads;
CREATE INDEX timeline_agent_position ON timeline(agentId,position);
CREATE INDEX timeline_agent_revision ON timeline(agentId,revision);
CREATE TRIGGER timeline_insert_revision AFTER INSERT ON timeline BEGIN
  UPDATE timeline_revision SET value=value+1 WHERE id=1;
  UPDATE timeline SET revision=(SELECT value FROM timeline_revision WHERE id=1) WHERE position=NEW.position;
END;
CREATE TRIGGER timeline_update_revision AFTER UPDATE OF message ON timeline WHEN OLD.message != NEW.message BEGIN
  UPDATE timeline_revision SET value=value+1 WHERE id=1;
  UPDATE timeline SET revision=(SELECT value FROM timeline_revision WHERE id=1) WHERE position=NEW.position;
END;
