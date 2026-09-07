import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { readConversationSnapshot } from "../src/server/runs/conversation-snapshot.server";
import { putMessage } from "../src/server/runs/timeline.server";
import { insertRun } from "../src/server/runs/store.server";
import { mergeEntries } from "../src/features/chat/timeline";

const run = Effect.runPromise;
const create = (directory: string) =>
  run(
    saveAgent(
      {
        id: randomUUID(),
        name: "Reader",
        instructions: "Help",
        character: "moss",
        model: "fake",
      },
      directory,
    ),
  );

test("local conversation snapshots preserve bounded history, files, cursors and active run state", async () => {
  const directory = mkdtempSync("/tmp/roost-conversation-snapshot-");
  try {
    const agent = await create(directory);
    const other = await create(directory);
    const runId = randomUUID();
    const file = {
      id: randomUUID(),
      name: "report.pdf",
      mimeType: "application/pdf",
      size: 20,
      kind: "artifact" as const,
      url: `/api/files?agentId=${agent.id}&id=${randomUUID()}`,
    };
    await run(
      withAgentStore((db) => {
        db.prepare("INSERT INTO timeline_imports (agentId) VALUES (?)").run(
          agent.id,
        );
        for (let i = 0; i < 70; i++)
          putMessage(db, agent.id, {
            id: `message-${i}`,
            role: "assistant",
            text: `Message ${i}`,
            ...(i === 65 ? { files: [file] } : {}),
          });
        putMessage(db, other.id, {
          id: "private",
          role: "user",
          text: "Other agent",
        });
        insertRun(db, {
          id: runId,
          agentId: agent.id,
          prompt: "Read the desktop",
        });
        db.prepare("UPDATE runs SET status='running' WHERE id=?").run(runId);
        putMessage(db, agent.id, {
          id: runId,
          role: "user",
          text: "Read the desktop",
        });
        putMessage(db, agent.id, {
          id: "computer",
          role: "activity",
          title: "roost_computer",
          text: "x".repeat(10000),
          details: "y".repeat(10000),
          status: "inProgress",
        });
      }, directory),
    );
    const snapshot = await run(
      readConversationSnapshot(agent.id, {}, directory),
    );
    assert.equal(snapshot.needsImport, false);
    assert.equal(snapshot.entries.length, 60);
    assert.equal(snapshot.entries[0]?.message.id, "message-12");
    assert.deepEqual(
      snapshot.entries.find((entry) => entry.message.id === "message-65")
        ?.message.files,
      [file],
    );
    assert.equal(snapshot.entries.at(-1)?.message.text.length, 2000);
    assert.equal(snapshot.entries.at(-1)?.message.details?.length, 2000);
    assert.equal(snapshot.entries.at(-1)?.message.truncated, true);
    assert.equal(snapshot.busy, true);
    assert.equal(snapshot.runId, runId);
    assert.equal(snapshot.computerAnchor, "computer");
    const older = await run(
      readConversationSnapshot(
        agent.id,
        { before: snapshot.before! },
        directory,
      ),
    );
    assert.equal(older.entries.length, 12);
    assert.equal(older.before, null);
    await run(
      withAgentStore((db) => {
        putMessage(db, agent.id, {
          id: "message-69",
          role: "assistant",
          text: "Updated during hydration",
        });
        db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(runId);
      }, directory),
    );
    const changes = await run(
      readConversationSnapshot(
        agent.id,
        { since: snapshot.revision },
        directory,
      ),
    );
    assert.deepEqual(
      changes.entries.map((entry) => entry.message.id),
      ["message-69"],
    );
    assert.equal(
      mergeEntries(snapshot.entries, changes.entries).find(
        (entry) => entry.message.id === "message-69",
      )?.message.text,
      "Updated during hydration",
    );
    assert.equal(changes.busy, false);
    assert.equal(changes.runId, null);
    assert.equal(changes.computerAnchor, null);
    assert.deepEqual(
      (
        await run(readConversationSnapshot(other.id, {}, directory))
      ).entries.map((entry) => entry.message.id),
      ["private"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("new agents are ready from local state while legacy imports remain deferred", async () => {
  const directory = mkdtempSync("/tmp/roost-conversation-local-");
  try {
    const agent = await create(directory);
    const empty = await run(readConversationSnapshot(agent.id, {}, directory));
    assert.equal(empty.needsImport, false);
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.busy, false);
    await run(
      withAgentStore(
        (db) =>
          db
            .prepare(
              "INSERT INTO conversations (agentId,threadId) VALUES (?,?)",
            )
            .run(agent.id, "legacy-offline-thread"),
        directory,
      ),
    );
    const legacy = await run(readConversationSnapshot(agent.id, {}, directory));
    assert.equal(legacy.needsImport, true);
    // Reading a snapshot neither imports the thread nor creates a Codex runtime.
    assert.equal(
      await run(
        withAgentStore(
          (db) =>
            db
              .prepare("SELECT agentId FROM timeline_imports WHERE agentId=?")
              .get(agent.id),
          directory,
        ),
      ),
      undefined,
    );
    assert.deepEqual(readdirSync(join(directory, "workspaces", agent.id)), []);
    await run(
      withAgentStore(
        (db) =>
          db
            .prepare("INSERT INTO timeline_imports (agentId) VALUES (?)")
            .run(agent.id),
        directory,
      ),
    );
    assert.equal(
      (await run(readConversationSnapshot(agent.id, {}, directory)))
        .needsImport,
      false,
    );
    await assert.rejects(
      run(readConversationSnapshot(randomUUID(), {}, directory)),
      /Agent not found/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
