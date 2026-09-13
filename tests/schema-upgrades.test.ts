import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Effect } from "effect";
import { withAgentStore } from "../src/server/agents/store.server";

for (const shape of [
  "base-v8",
  "datasets-v9",
  "models-v9",
  "current-v10",
] as const) {
  test(`combined migration preserves data from ${shape} and is repeatable`, async () => {
    const directory = mkdtempSync("/tmp/roost-schema-upgrade-");
    try {
      const db = new DatabaseSync(join(directory, "roost.sqlite"));
      try {
        db.exec(
          readFileSync(new URL("./fixtures/v8.sql", import.meta.url), "utf8"),
        );
        db.exec(
          `CREATE TABLE dashboard_datasets (agentId TEXT NOT NULL,key TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL,updatedAt INTEGER NOT NULL,PRIMARY KEY(agentId,key)); ALTER TABLE automations ADD COLUMN model TEXT`,
        );
        db.exec(`
          INSERT INTO agents(id,name,instructions,character,model,createdAt)
            VALUES('saved','Scout','Keep my instructions','moss','fake','2026-09-08');
          INSERT INTO agent_sessions VALUES('saved','old-thread','[{"text":"Saved history"}]');
          INSERT INTO agent_tool_versions VALUES('old-thread',11);
          INSERT INTO automations(id,agentId,name,prompt,schedule,notification,revision,enabled,nextRunAt,model)
            VALUES('task','saved','Status','Keep this task','{"kind":"interval","minutes":60}',
              'when-needed',4,0,NULL,'gpt-5.6-luna');
          INSERT INTO dashboards(agentId,key,title,blocks,revision,updatedAt)
            VALUES('saved','legacy','Saved board','[]',3,123);
          INSERT INTO dashboard_datasets VALUES('saved','weekly','{"rows":[["Week 1",6]]}',7,456);
          UPDATE dashboard_settings SET enabled=1;
          UPDATE runtime_control SET maintenance=1;
        `);
        if (shape !== "models-v9" && shape !== "current-v10")
          db.exec("ALTER TABLE automations DROP COLUMN model");
        if (shape !== "datasets-v9" && shape !== "current-v10")
          db.exec("DROP TABLE dashboard_datasets");
        db.exec(
          `PRAGMA user_version=${shape === "base-v8" ? 8 : shape === "current-v10" ? 10 : 9}`,
        );
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .all()
          .map((row) => String(row.name));
        const snapshots = tables.map((name) => ({
          name,
          columns: db
            .prepare(`PRAGMA table_info("${name}")`)
            .all()
            .map((row) => String(row.name)),
          rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
        }));
        db.close();
        for (let attempt = 0; attempt < 2; attempt++) {
          await Effect.runPromise(
            withAgentStore((upgraded) => {
              assert.equal(
                upgraded.prepare("PRAGMA user_version").get()?.user_version,
                14,
              );
              for (const { name, columns, rows } of snapshots) {
                assert.deepEqual(
                  upgraded
                    .prepare(
                      `SELECT ${columns.map((column) => `"${column}"`).join(",")} FROM "${name}" ORDER BY rowid`,
                    )
                    .all(),
                  rows,
                  `${name} must survive ${shape} upgrade ${attempt}`,
                );
              }
              assert.equal(
                upgraded
                  .prepare("SELECT model FROM automations WHERE id='task'")
                  .get()?.model,
                shape === "models-v9" || shape === "current-v10"
                  ? "gpt-5.6-luna"
                  : null,
              );
              assert.equal(
                upgraded
                  .prepare("SELECT count(*) AS total FROM dashboard_datasets")
                  .get()?.total,
                shape === "datasets-v9" || shape === "current-v10" ? 1 : 0,
              );
            }, directory),
          );
        }
      } finally {
        if (db.isOpen) db.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

const fixtureSql = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}.sql`, import.meta.url), "utf8");

function snapshot(db: DatabaseSync) {
  return {
    version: db.prepare("PRAGMA user_version").get(),
    schema: db.prepare("SELECT * FROM sqlite_master ORDER BY name").all(),
    tables: db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map(({ name }) => ({
        name,
        rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
      })),
  };
}

function historical(db: DatabaseSync, threads: number, notes: boolean) {
  db.exec(fixtureSql("v8"));
  db.exec(`CREATE TABLE dashboard_datasets(agentId TEXT NOT NULL,key TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL,updatedAt INTEGER NOT NULL,PRIMARY KEY(agentId,key));
    ALTER TABLE automations ADD COLUMN model TEXT;
    INSERT INTO agents(id,name,instructions,character,model,createdAt) VALUES('saved','Scout','Instructions','moss','saved-model','2026-09-08');
    INSERT INTO agent_sessions VALUES('saved','native-thread','[{"text":"archive"}]');
    INSERT INTO conversations VALUES('saved','native-thread');
    INSERT INTO timeline(id,agentId,message) VALUES('stable-message','saved','{"role":"assistant","text":"Keep"}');
    INSERT INTO runs(id,agentId,kind,prompt,status,createdAt,owner,threadId) VALUES('saved-run','saved','chat','Keep','running',123,'saved-owner','native-thread');
    PRAGMA user_version=10;`);
  if (notes) {
    db.exec(fixtureSql("notes-v11"));
    const blocks =
      '[{"id":"12345678-1234-4234-8234-123456789abc","type":"paragraph","content":[{"text":"Keep this"}]}]';
    const saved = JSON.stringify({
      agentId: "saved",
      revision: 7,
      blocks: JSON.parse(blocks),
      instructions: "User instructions",
      updatedAt: 123,
    });
    db.prepare(
      "INSERT INTO agent_notes VALUES('saved',7,?,'User instructions',123)",
    ).run(blocks);
    db.prepare(
      "INSERT INTO note_revisions VALUES('saved',7,?,'agent:saved-run')",
    ).run(saved);
    db.prepare(
      "INSERT INTO note_requests VALUES('saved','receipt','fingerprint',?)",
    ).run(saved);
    db.exec(
      "INSERT INTO note_reads VALUES('saved-token','saved','saved-run',7,9999999999999)",
    );
  }
  for (let version = 11; version <= threads; version++)
    db.exec(fixtureSql(`threads-v${version}`));
  if (threads >= 12)
    db.exec(
      "UPDATE conversation_sessions SET provider='claude',model='saved-provider-model'",
    );
  if (threads >= 13)
    db.exec("UPDATE provider_message_ids SET nativeId='native-message'");
}

for (const [threads, notes] of [
  [0, false],
  [0, true],
  [11, false],
  [12, false],
  [13, false],
  [11, true],
  [12, true],
  [13, true],
] as const) {
  test(`shape upgrade preserves Notes=${notes}, Threads=${threads || "none"}, run ownership and stable identities`, async () => {
    const directory = mkdtempSync("/tmp/roost-feature-upgrade-");
    try {
      const db = new DatabaseSync(join(directory, "roost.sqlite"));
      historical(db, threads, notes);
      const before = snapshot(db);
      db.close();
      for (let attempt = 0; attempt < 2; attempt++)
        await Effect.runPromise(
          withAgentStore((upgraded) => {
            assert.equal(
              upgraded.prepare("PRAGMA user_version").get()?.user_version,
              14,
            );
            for (const { name, rows } of before.tables) {
              if (name === "sqlite_sequence" || rows.length === 0) continue;
              const columns = Object.keys(rows[0]!);
              assert.deepEqual(
                upgraded
                  .prepare(
                    `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM "${name}" ORDER BY rowid`,
                  )
                  .all(),
                rows,
                `${name} survives`,
              );
            }
            assert.equal(
              upgraded
                .prepare("SELECT conversationId FROM runs WHERE id='saved-run'")
                .get()?.conversationId,
              "saved",
            );
            const session = upgraded
              .prepare(
                "SELECT * FROM conversation_sessions WHERE conversationId='saved'",
              )
              .get()!;
            assert.equal(session.provider, threads >= 12 ? "claude" : "codex");
            assert.equal(
              session.model,
              threads >= 12 ? "saved-provider-model" : "saved-model",
            );
            assert.equal(
              upgraded
                .prepare("SELECT nativeId FROM provider_message_ids")
                .get()?.nativeId,
              threads >= 13 ? "native-message" : "stable-message",
            );
            assert.equal(
              upgraded
                .prepare("SELECT MAX(version) v FROM coding_workspace_versions")
                .get()?.v,
              3,
            );
          }, directory),
        );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const damage of [
  "DROP TABLE note_reads",
  "ALTER TABLE agent_notes ADD COLUMN unexpected TEXT",
  "DROP TABLE note_requests; CREATE TABLE note_requests(agentId TEXT NOT NULL,requestId TEXT NOT NULL,fingerprint TEXT NOT NULL,snapshot TEXT NOT NULL)",
  "CREATE TABLE conversation_records(id TEXT)",
  "CREATE TABLE provider_message_ids(agentId TEXT)",
  "CREATE TABLE coding_workspace_versions(version INTEGER PRIMARY KEY); INSERT INTO coding_workspace_versions VALUES(99)",
  // Failure after timeline reconstruction must roll back every earlier step.
  "UPDATE timeline SET message='malformed JSON'",
] as const) {
  test(`malformed/unsupported shape rolls back schema and every saved row: ${damage}`, async () => {
    const directory = mkdtempSync("/tmp/roost-rejected-upgrade-");
    try {
      const db = new DatabaseSync(join(directory, "roost.sqlite"));
      historical(db, 0, true);
      db.exec(damage);
      const before = snapshot(db);
      db.close();
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(
          Effect.runPromise(
            withAgentStore(() => assert.fail("must refuse"), directory),
          ),
        );
        const after = new DatabaseSync(join(directory, "roost.sqlite"));
        try {
          assert.deepEqual(snapshot(after), before);
        } finally {
          after.close();
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const legacy of [
  "deletion-v11",
  "core14",
  "core14-with-navigation",
] as const) {
  test(`deletion feature migration preserves ${legacy} and installs the cumulative contracts`, async () => {
    const directory = mkdtempSync("/tmp/roost-delete-upgrade-");
    try {
      if (legacy === "deletion-v11") {
        const db = new DatabaseSync(join(directory, "roost.sqlite"));
        db.exec(
          readFileSync(new URL("./fixtures/v8.sql", import.meta.url), "utf8"),
        );
        db.exec(`CREATE TABLE dashboard_datasets(agentId TEXT NOT NULL,key TEXT NOT NULL,content TEXT NOT NULL,revision INTEGER NOT NULL,updatedAt INTEGER NOT NULL,PRIMARY KEY(agentId,key));
          ALTER TABLE automations ADD COLUMN model TEXT;
          CREATE TABLE deleted_agents(id TEXT PRIMARY KEY,deletedAt INTEGER NOT NULL);
          INSERT INTO deleted_agents VALUES('deleted',123);
          INSERT INTO agents(id,name,instructions,character,model,createdAt) VALUES('saved','Scout','Keep','moss','fake','today');
          PRAGMA user_version=11;`);
        db.close();
      } else {
        await Effect.runPromise(
          withAgentStore((db) => {
            const triggers = db
              .prepare(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'deleted_%'",
              )
              .all();
            for (const { name } of triggers) db.exec(`DROP TRIGGER ${name}`);
            db.exec(
              "DROP TABLE agent_deletion_versions; DROP TABLE deleted_agents;",
            );
            if (legacy === "core14")
              db.exec(
                "DROP TABLE agent_navigation_memberships; DROP TABLE agent_navigation_sections; DROP TABLE agent_navigation_versions;",
              );
          }, directory),
        );
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        await Effect.runPromise(
          withAgentStore((db) => {
            assert.equal(
              db.prepare("PRAGMA user_version").get()?.user_version,
              14,
            );
            for (const [table, version] of [
              ["agent_deletion_versions", 1],
              ["agent_navigation_versions", 1],
              ["coding_workspace_versions", 3],
            ] as const)
              assert.equal(
                db.prepare(`SELECT MAX(version) v FROM ${table}`).get()?.v,
                version,
              );
            if (legacy === "deletion-v11") {
              assert.equal(
                db
                  .prepare(
                    "SELECT deletedAt FROM deleted_agents WHERE id='deleted'",
                  )
                  .get()?.deletedAt,
                123,
              );
              assert.equal(
                db.prepare("SELECT name FROM agents WHERE id='saved'").get()
                  ?.name,
                "Scout",
              );
              assert.throws(
                () =>
                  db.exec(
                    "INSERT INTO note_reads VALUES('late','deleted','scope',0,0)",
                  ),
                /deleted/,
              );
            }
          }, directory),
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const corrupt of ["future-deletion", "malformed-tombstones"] as const) {
  test(`${corrupt} refuses migration without modifying the database`, async () => {
    const directory = mkdtempSync("/tmp/roost-delete-refusal-");
    try {
      await Effect.runPromise(
        withAgentStore((db) => {
          if (corrupt === "future-deletion")
            db.exec("INSERT INTO agent_deletion_versions VALUES(99)");
          else db.exec("ALTER TABLE deleted_agents ADD COLUMN unexpected TEXT");
        }, directory),
      );
      const path = join(directory, "roost.sqlite");
      const before = readFileSync(path);
      await assert.rejects(
        Effect.runPromise(withAgentStore(() => {}, directory)),
        /newer version|Unsupported database shape/,
      );
      assert.deepEqual(readFileSync(path), before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
