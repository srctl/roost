-- Historical Threads migration from the prepared main merge stage.
BEGIN IMMEDIATE;
            CREATE TABLE conversation_records (
              id TEXT PRIMARY KEY, agentId TEXT NOT NULL,
              parentConversationId TEXT, parentMessageId TEXT, parent TEXT,
              createdAt INTEGER NOT NULL, deletedAt INTEGER,
              UNIQUE(agentId,parentConversationId,parentMessageId)
            );
            INSERT INTO conversation_records(id,agentId,createdAt)
              SELECT id,id,0 FROM agents;
            CREATE TABLE conversation_sessions (
              conversationId TEXT PRIMARY KEY, agentId TEXT NOT NULL,
              threadId TEXT NOT NULL, archive TEXT NOT NULL
            );
            INSERT INTO conversation_sessions SELECT agentId,agentId,threadId,archive FROM agent_sessions;
            ALTER TABLE runs ADD COLUMN conversationId TEXT NOT NULL DEFAULT '';
            UPDATE runs SET conversationId=agentId;
            CREATE TRIGGER runs_main_conversation AFTER INSERT ON runs WHEN NEW.conversationId='' BEGIN
              UPDATE runs SET conversationId=NEW.agentId WHERE id=NEW.id;
            END;
            DROP TRIGGER timeline_insert_revision;
            DROP TRIGGER timeline_update_revision;
            ALTER TABLE timeline RENAME TO timeline_legacy;
            CREATE TABLE timeline (
              position INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL,
              agentId TEXT NOT NULL, conversationId TEXT NOT NULL,
              message TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
              createdAt INTEGER NOT NULL DEFAULT 0,
              UNIQUE(agentId,conversationId,id)
            );
            INSERT INTO timeline(position,id,agentId,conversationId,message,revision)
              SELECT position,id,agentId,agentId,message,revision FROM timeline_legacy;
            DROP TABLE timeline_legacy;
            CREATE INDEX timeline_agent_position ON timeline(agentId,conversationId,position);
            CREATE INDEX timeline_agent_revision ON timeline(agentId,conversationId,revision);
            CREATE TRIGGER timeline_insert_revision AFTER INSERT ON timeline BEGIN
              UPDATE timeline_revision SET value=value+1 WHERE id=1;
              UPDATE timeline SET revision=(SELECT value FROM timeline_revision WHERE id=1) WHERE position=NEW.position;
            END;
            CREATE TRIGGER timeline_update_revision AFTER UPDATE OF message ON timeline WHEN OLD.message != NEW.message BEGIN
              UPDATE timeline_revision SET value=value+1 WHERE id=1;
              UPDATE timeline SET revision=(SELECT value FROM timeline_revision WHERE id=1) WHERE position=NEW.position;
            END;
            PRAGMA user_version = 11;
            COMMIT;
