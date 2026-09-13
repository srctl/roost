import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { readConversationSnapshot } from "../src/server/runs/conversation-snapshot.server";
import {
  claimRun,
  claimSteeringRun,
  enqueueChat,
  finishRun,
  persistRun,
  schedulerTick,
} from "../src/server/runs/store.server";
import {
  openReplyThread,
  readSharedContext,
} from "../src/server/runs/threads.server";
import { putMessage } from "../src/server/runs/timeline.server";

test("threads isolate identity, collision-prone provider output, queue/steering and bounded shared context", async () => {
  const root = mkdtempSync(join(tmpdir(), "roost-threads-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  const run = Effect.runPromise;
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Moss",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const other = await run(
      saveAgent({
        id: randomUUID(),
        name: "Other",
        instructions: "Help",
        character: "wisp",
        model: "fake",
      }),
    );
    await run(
      withAgentStore((db) => {
        putMessage(db, agent.id, {
          id: "parent",
          role: "user",
          text: "Release plan",
        });
        putMessage(db, agent.id, {
          id: "tool",
          role: "activity",
          text: "output",
        });
        putMessage(db, other.id, {
          id: "parent",
          role: "user",
          text: "Private",
        });
      }),
    );
    const child = await run(openReplyThread(agent.id, "parent"));
    assert.deepEqual(await run(openReplyThread(agent.id, "parent")), child);
    await assert.rejects(run(openReplyThread(agent.id, "missing")));
    await assert.rejects(run(openReplyThread(agent.id, "tool")));
    await assert.rejects(run(openReplyThread(agent.id, "parent", child.id)));
    const input = {
      agentId: agent.id,
      conversationId: child.id,
      messageId: randomUUID(),
      text: "Review accessibility",
    };
    await run(enqueueChat(input));
    await run(enqueueChat(input));
    await assert.rejects(
      run(enqueueChat({ ...input, conversationId: agent.id })),
    );
    await run(schedulerTick("test"));
    const active = await run(claimRun("test"));
    assert.equal(active?.conversationId, child.id);
    assert.ok(active);
    const main = await run(
      enqueueChat({
        agentId: agent.id,
        messageId: randomUUID(),
        text: "New main decision: Friday",
      }),
    );
    assert.notEqual(main.id, active.id);
    assert.equal(await run(claimSteeringRun(active)), undefined);
    assert.equal(await run(claimRun("test")), undefined);
    const follow = await run(
      enqueueChat({
        ...input,
        messageId: randomUUID(),
        text: "Check touch targets",
      }),
    );
    assert.equal(follow.id, active.id);
    assert.equal(
      (await run(claimSteeringRun(active)))?.conversationId,
      child.id,
    );
    await run(
      persistRun(active, [
        { id: "provider-id", role: "assistant", text: "Thread answer" },
      ]),
    );
    await run(
      withAgentStore((db) => {
        putMessage(db, agent.id, {
          id: "provider-id",
          role: "assistant",
          text: "Main answer",
        });
        putMessage(db, other.id, {
          id: "provider-id",
          role: "assistant",
          text: "Other answer",
        });
      }),
    );
    const snapshot = await run(
      readConversationSnapshot(agent.id, { conversationId: child.id }),
    );
    assert.equal(snapshot.threads[0]?.replyCount, 3);
    assert.equal(
      snapshot.entries.filter((e) => e.message.id === input.messageId).length,
      1,
    );
    assert.ok(snapshot.entries.some((e) => e.message.text === "Thread answer"));
    assert.ok(!snapshot.entries.some((e) => e.message.text === "Main answer"));
    assert.ok(
      (await run(readConversationSnapshot(agent.id))).entries.some(
        (e) => e.message.text === "Main answer",
      ),
    );
    await assert.rejects(
      run(readConversationSnapshot(other.id, { conversationId: child.id })),
    );
    const latest = await run(
      readSharedContext(agent.id, {
        newest: true,
        query: "decision",
        limit: 1,
      }),
    );
    assert.equal(latest.entries.length, 1);
    assert.match(latest.entries[0]!.text, /Friday/);
    assert.equal(latest.entries[0]!.conversationId, agent.id);
    const sibling = await run(openReplyThread(agent.id, "provider-id"));
    await run(
      withAgentStore((db) =>
        putMessage(
          db,
          agent.id,
          { id: "provider-id", role: "assistant", text: "Sibling answer" },
          sibling.id,
        ),
      ),
    );
    assert.equal(
      (await run(readSharedContext(agent.id, { conversationId: sibling.id })))
        .entries[0]?.text,
      "Sibling answer",
    );
    await assert.rejects(
      run(readSharedContext(other.id, { conversationId: sibling.id })),
    );
    await run(
      withAgentStore((db) => {
        for (let i = 0; i < 25; i++)
          putMessage(
            db,
            agent.id,
            { id: `long-${i}`, role: "assistant", text: "x".repeat(5000) },
            sibling.id,
          );
      }),
    );
    const bounded = await run(
      readSharedContext(agent.id, {
        conversationId: sibling.id,
        newest: true,
        limit: 20,
      }),
    );
    assert.equal(bounded.entries.length, 20);
    assert.ok(bounded.next);
    assert.ok(JSON.stringify(bounded).length < 40000);
    assert.ok(bounded.entries.every((e) => e.text.length <= 1500));
    const page = await run(
      readSharedContext(agent.id, {
        conversationId: sibling.id,
        newest: true,
        before: bounded.next!,
        limit: 20,
      }),
    );
    assert.equal(page.entries.length, 6);
    await run(finishRun(active, "failed", [], "Origin error"));
    const childAfter = await run(
      readConversationSnapshot(agent.id, { conversationId: child.id }),
    );
    assert.ok(
      childAfter.entries.some((e) => e.message.text === "Origin error"),
    );
    assert.ok(
      !(await run(readConversationSnapshot(agent.id))).entries.some(
        (e) => e.message.text === "Origin error",
      ),
    );
    assert.equal((await run(claimRun("test")))?.id, main.id);
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

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

test("deleted threads retain origin and parent snapshots, fence sends and never reopen", async () => {
  const { deleteReplyThread, runConversationId } = await import(
    "../src/server/runs/threads.server"
  );
  const root = mkdtempSync(join(tmpdir(), "roost-deleted-thread-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  try {
    const agent = await Effect.runPromise(
      saveAgent({
        id: randomUUID(),
        name: "Moss",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    await Effect.runPromise(
      withAgentStore((db) =>
        putMessage(db, agent.id, {
          id: "parent",
          role: "user",
          text: "Original parent",
        }),
      ),
    );
    const [a, b] = await Promise.all([
      Effect.runPromise(openReplyThread(agent.id, "parent")),
      Effect.runPromise(openReplyThread(agent.id, "parent")),
    ]);
    assert.equal(a.id, b.id);
    await Effect.runPromise(
      withAgentStore((db) =>
        putMessage(db, agent.id, {
          id: "parent",
          role: "assistant",
          text: "Completed parent",
        }),
      ),
    );
    assert.equal(
      (
        await Effect.runPromise(
          readConversationSnapshot(agent.id, { conversationId: a.id }),
        )
      ).threads[0]?.parent.text,
      "Completed parent",
    );
    const input = {
      agentId: agent.id,
      conversationId: a.id,
      messageId: randomUUID(),
      text: "Queued reply",
    };
    await Promise.all([
      Effect.runPromise(enqueueChat(input)),
      Effect.runPromise(enqueueChat(input)),
    ]);
    await Effect.runPromise(
      withAgentStore((db) =>
        db
          .prepare("DELETE FROM timeline WHERE agentId=? AND id=?")
          .run(agent.id, "parent"),
      ),
    );
    assert.equal(
      (
        await Effect.runPromise(
          readConversationSnapshot(agent.id, { conversationId: a.id }),
        )
      ).threads[0]?.parent.text,
      "Completed parent",
    );
    await Effect.runPromise(deleteReplyThread(agent.id, a.id));
    await assert.rejects(
      Effect.runPromise(openReplyThread(agent.id, "parent")),
    );
    await assert.rejects(
      Effect.runPromise(enqueueChat({ ...input, messageId: randomUUID() })),
    );
    await Effect.runPromise(
      withAgentStore((db) => {
        assert.equal(runConversationId(db, agent.id, input.messageId), a.id);
        assert.equal(
          db.prepare("SELECT status FROM runs WHERE id=?").get(input.messageId)!
            .status,
          "cancelled",
        );
        assert.equal(
          db
            .prepare("SELECT count(*) n FROM runs WHERE id=?")
            .get(input.messageId)!.n,
          1,
        );
      }),
    );
    assert.equal(
      (await Effect.runPromise(readSharedContext(agent.id, {}))).entries.length,
      0,
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
