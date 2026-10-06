import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  saveAgent,
  saveConversationThread,
  withAgentStore,
} from "../src/server/agents/store.server";

test("Astra migration is scoped, keeps private content out of rollback data, and refuses active/conflicting work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-model-migration-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const script = fileURLToPath(
    new URL("../../../scripts/migrate-astra-to-sol.mjs", import.meta.url),
  );
  const backup = join(directory, "rollback.json");
  const command = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [script, join(directory, "roost.sqlite"), ...args],
      { encoding: "utf8" },
    );
  const run = Effect.runPromise;
  try {
    const astra = await run(
      saveAgent({
        id: randomUUID(),
        name: "Scout",
        instructions: "Keep this soul",
        character: "moss",
        model: "gpt-6-astra",
        reasoningEffort: "high",
      }),
    );
    const luna = await run(
      saveAgent({
        id: randomUUID(),
        name: "Luna",
        instructions: "Keep this too",
        character: "wisp",
        model: "gpt-5.6-luna",
      }),
    );
    const threadId = randomUUID();
    await run(saveConversationThread(astra.id, threadId, "[]"));
    const automationId = randomUUID(),
      queuedId = randomUUID(),
      completedId = randomUUID();
    await run(
      withAgentStore((db) => {
        db.prepare(
          "INSERT INTO automations(id,agentId,name,prompt,schedule,notification,revision,enabled,model,reasoningEffort) VALUES(?,?,'Test','PRIVATE_FIXTURE','{}','always',2,1,'gpt-6-astra','high')",
        ).run(automationId, astra.id);
        for (const [id, status] of [
          [queuedId, "queued"],
          [completedId, "completed"],
        ])
          db.prepare(
            "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt,automationSnapshot) VALUES(?,?,'automation','PRIVATE_FIXTURE',?,0,?)",
          ).run(
            id,
            astra.id,
            status,
            JSON.stringify({ model: "gpt-6-astra", prompt: "PRIVATE_FIXTURE" }),
          );
      }),
    );
    const dry = command();
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(JSON.parse(dry.stdout).counts, {
      agents: 1,
      conversations: 1,
      automations: 1,
      queuedRuns: 1,
    });
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET status='running' WHERE id=?").run(queuedId),
      ),
    );
    const busy = command("--apply", backup);
    assert.notEqual(busy.status, 0);
    assert.match(busy.stderr, /Active runs/);
    assert.equal(
      await run(
        withAgentStore(
          (db) =>
            db.prepare("SELECT maintenance FROM runtime_control").get()
              ?.maintenance,
        ),
      ),
      0,
    );
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET status='queued' WHERE id=?").run(queuedId),
      ),
    );
    const applied = command("--apply", backup);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(statSync(backup).mode & 0o777, 0o600);
    assert.ok(!readFileSync(backup, "utf8").includes("PRIVATE_FIXTURE"));
    await run(
      withAgentStore((db) => {
        assert.equal(
          db.prepare("SELECT model FROM agents WHERE id=?").get(luna.id)?.model,
          "gpt-5.6-luna",
        );
        const session = db
          .prepare("SELECT * FROM conversation_sessions WHERE agentId=?")
          .get(astra.id);
        assert.equal(session?.model, "gpt-6.1-sol");
        assert.equal(session?.threadId, threadId);
        assert.equal(
          db
            .prepare(
              "SELECT json_extract(automationSnapshot,'$.model') model FROM runs WHERE id=?",
            )
            .get(completedId)?.model,
          "gpt-6-astra",
          "historical runs retain their actual model",
        );
        db.prepare("UPDATE agents SET reasoningEffort='medium' WHERE id=?").run(
          astra.id,
        );
      }),
    );
    const conflict = command("--rollback", backup);
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /settings changed/);
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE agents SET reasoningEffort='low' WHERE id=?")
          .run(astra.id),
      ),
    );
    const rolledBack = command("--rollback", backup);
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    await run(
      withAgentStore((db) => {
        assert.equal(
          db.prepare("SELECT model FROM agents WHERE id=?").get(astra.id)
            ?.model,
          "gpt-6-astra",
        );
        assert.equal(
          db
            .prepare("SELECT revision FROM automations WHERE id=?")
            .get(automationId)?.revision,
          2,
        );
        assert.equal(
          db
            .prepare(
              "SELECT json_type(automationSnapshot,'$.reasoningEffort') effort FROM runs WHERE id=?",
            )
            .get(queuedId)?.effort,
          null,
        );
        assert.equal(
          db.prepare("SELECT maintenance FROM runtime_control").get()
            ?.maintenance,
          0,
        );
      }),
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
