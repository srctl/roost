-- Historical Threads migration from the prepared main merge stage.
BEGIN IMMEDIATE;
          CREATE TABLE provider_message_ids(agentId TEXT NOT NULL,conversationId TEXT NOT NULL,threadId TEXT NOT NULL,nativeId TEXT NOT NULL,messageId TEXT NOT NULL,PRIMARY KEY(agentId,conversationId,threadId,nativeId));
          INSERT OR IGNORE INTO provider_message_ids SELECT t.agentId,t.conversationId,COALESCE(s.threadId,c.threadId),t.id,t.id FROM timeline t LEFT JOIN conversation_sessions s ON s.conversationId=t.conversationId LEFT JOIN conversations c ON c.agentId=t.agentId WHERE COALESCE(s.threadId,c.threadId) IS NOT NULL AND json_extract(t.message,'$.role') IN ('assistant','activity');
          PRAGMA user_version=13; COMMIT;
