import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { withAgentStore } from "../src/server/agents/store.server";

test("v8 migration preserves positions, revisions, archives, native session identity and queue ownership", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { getAgentConversation } = await import(
    "../src/server/agents/store.server"
  );
  const root = mkdtempSync(join(tmpdir(), "roost-v8-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  const id = randomUUID();
  const native = "native-provider-session";
  try {
    const db = new DatabaseSync(join(root, "roost.sqlite"));
    db.exec(
      readFileSync(new URL("./fixtures/v8.sql", import.meta.url), "utf8"),
    );
    db.prepare(
      "INSERT INTO agents(id,name,instructions,character,model,createdAt) VALUES (?,'Legacy','Help','moss','legacy-model','2025-01-01')",
    ).run(id);
    const archive = JSON.stringify([
      { id: "archived", role: "assistant", text: "Archived visible history" },
    ]);
    db.prepare("INSERT INTO agent_sessions VALUES (?,?,?)").run(
      id,
      native,
      archive,
    );
    db.prepare("INSERT INTO conversation_instructions VALUES (?,?)").run(
      native,
      "original instructions",
    );
    db.prepare("INSERT INTO agent_tool_versions VALUES (?,10)").run(native);
    db.prepare(
      "INSERT INTO timeline(position,id,agentId,message) VALUES (42,?,?,?)",
    ).run(
      "legacy-message",
      id,
      JSON.stringify({
        id: "legacy-message",
        role: "assistant",
        text: "Prior decision",
      }),
    );
    const revision = db
      .prepare("SELECT revision FROM timeline WHERE position=42")
      .get()!.revision;
    db.prepare(
      "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt,owner,threadId) VALUES (?,?,'chat','Queued work','queued',99,'old-owner',?)",
    ).run("legacy-run", id, native);
    db.close();
    const read = await Effect.runPromise(getAgentConversation(id));
    assert.equal(read.threadId, native);
    assert.equal(read.archive, archive);
    assert.equal(read.sessionModel, "legacy-model");
    assert.equal(read.provider, "codex");
    assert.equal(read.appliedInstructions, "original instructions");
    await Effect.runPromise(
      withAgentStore((db) => {
        const row = db
          .prepare("SELECT * FROM timeline WHERE position=42")
          .get()!;
        assert.equal(row.revision, revision);
        assert.equal(row.conversationId, id);
        const queued = db
          .prepare("SELECT * FROM runs WHERE id='legacy-run'")
          .get()!;
        assert.equal(queued.owner, "old-owner");
        assert.equal(queued.threadId, native);
        assert.equal(queued.conversationId, id);
        assert.equal(queued.status, "queued");
        assert.equal(
          db
            .prepare("SELECT archive FROM agent_sessions WHERE agentId=?")
            .get(id)!.archive,
          archive,
        );
        assert.equal(
          db
            .prepare("SELECT id FROM conversation_records WHERE agentId=?")
            .get(id)!.id,
          id,
        );
      }),
    );
    assert.equal(
      (await Effect.runPromise(getAgentConversation(id))).threadId,
      native,
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
