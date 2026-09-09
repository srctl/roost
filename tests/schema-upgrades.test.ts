import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Effect } from "effect";
import { withAgentStore } from "../src/server/agents/store.server";

for (const shape of ["base-v8", "datasets-v9", "models-v9"] as const) {
  test(`combined migration preserves data from ${shape} and is repeatable`, async () => {
    const directory = mkdtempSync("/tmp/roost-schema-upgrade-");
    try {
      await Effect.runPromise(withAgentStore(() => {}, directory));
      const db = new DatabaseSync(join(directory, "roost.sqlite"));
      try {
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
        if (shape !== "models-v9")
          db.exec("ALTER TABLE automations DROP COLUMN model");
        if (shape !== "datasets-v9") db.exec("DROP TABLE dashboard_datasets");
        db.exec(`PRAGMA user_version=${shape === "base-v8" ? 8 : 9}`);
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
                11,
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
                shape === "models-v9" ? "gpt-5.6-luna" : null,
              );
              assert.equal(
                upgraded
                  .prepare("SELECT count(*) AS total FROM dashboard_datasets")
                  .get()?.total,
                shape === "datasets-v9" ? 1 : 0,
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
