-- Historical Notes migration from PR20.
BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS agent_notes (agentId TEXT PRIMARY KEY, revision INTEGER NOT NULL, blocks TEXT NOT NULL, instructions TEXT NOT NULL, updatedAt INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS note_revisions (agentId TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY(agentId,revision));
            CREATE TABLE IF NOT EXISTS note_requests (agentId TEXT NOT NULL, requestId TEXT NOT NULL, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL, PRIMARY KEY(agentId,requestId));
            CREATE TABLE IF NOT EXISTS note_reads (token TEXT PRIMARY KEY, agentId TEXT NOT NULL, scope TEXT NOT NULL, revision INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
            PRAGMA user_version = 11;
            COMMIT;
