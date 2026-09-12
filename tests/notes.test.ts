import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import {
  NoteContent,
  reconcileNote,
  safeNoteUrl,
} from "../src/features/notes/schema";
import { saveAgent } from "../src/server/agents/store.server";
import { handleAgentTool } from "../src/server/codex/agent-tools.server";
import {
  noteHistory,
  patchNote,
  readNote,
  restoreNote,
  saveNote,
  saveNoteInstructions,
} from "../src/server/notes/store.server";

const block = (text: string) => ({
  id: randomUUID(),
  type: "paragraph" as const,
  content: [{ text }],
});
const run = Effect.runPromise;
test("notes persist independently; CAS, instructions, scoped reads, targeted edits, idempotency and restore preserve boundaries", async () => {
  const directory = mkdtempSync("/tmp/roost-note-test-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const create = () =>
      run(
        saveAgent({
          id: randomUUID(),
          name: "Notes",
          instructions: "Help",
          character: "moss",
          model: "fake",
        }),
      );
    const a = await create();
    const b = await create();
    const user = block("Keep this user paragraph");
    const target = block("Agent section");
    const initial = await run(readNote(a.id));
    assert.equal(initial.revision, 0);
    const input = {
      requestId: randomUUID(),
      revision: 0,
      blocks: [user, target],
    };
    const first = await run(saveNote(a.id, input));
    assert.equal(first.revision, 1);
    assert.deepEqual(await run(saveNote(a.id, input)), first);
    await assert.rejects(
      run(saveNote(a.id, { ...input, blocks: [] })),
      /request ID/,
    );
    const instructed = await run(
      saveNoteInstructions(a.id, {
        requestId: randomUUID(),
        revision: 1,
        instructions: "Maintain the agent section only",
      }),
    );
    assert.deepEqual(instructed.blocks, first.blocks);
    await assert.rejects(
      run(saveNote(a.id, { ...input, requestId: randomUUID() })),
      /NOTE_CONFLICT/,
    );
    const read = await run(readNote(a.id, "run-a"));
    const patch = {
      requestId: randomUUID(),
      revision: read.revision,
      readToken: read.readToken!,
      edits: [
        {
          id: target.id,
          before: target,
          after: { ...target, content: [{ text: "Updated" }] },
        },
      ],
    };
    await assert.rejects(
      run(patchNote(a.id, "run-b", patch)),
      /Read the current/,
    );
    await assert.rejects(
      run(patchNote(b.id, "run-a", { ...patch, revision: 0 })),
      /Read the current/,
    );
    const updated = await run(patchNote(a.id, "run-a", patch));
    assert.deepEqual(updated.blocks[0], user);
    assert.equal(updated.instructions, instructed.instructions);
    assert.deepEqual(await run(patchNote(a.id, "run-a", patch)), updated);
    await assert.rejects(
      run(
        patchNote(a.id, "run-a", {
          ...patch,
          requestId: randomUUID(),
          revision: updated.revision,
        }),
      ),
      /Read the current/,
    );
    assert.deepEqual((await run(readNote(b.id))).blocks, []);
    const restored = await run(
      restoreNote(a.id, {
        requestId: randomUUID(),
        revision: updated.revision,
        targetRevision: 1,
      }),
    );
    assert.deepEqual(restored.blocks, first.blocks);
    assert.equal(restored.instructions, instructed.instructions);
    await assert.rejects(
      run(
        restoreNote(b.id, {
          requestId: randomUUID(),
          revision: 0,
          targetRevision: 1,
        }),
      ),
      /not found/,
    );
    assert.equal((await run(noteHistory(a.id))).length, 5);
    await assert.rejects(run(readNote("../../other")), /Agent not found/);
    const denied = await handleAgentTool(
      { agentId: a.id, runId: "run-a", allowMutations: false },
      "roost_patch_note",
      patch,
    );
    assert.equal(denied.success, false);
    const reread = await run(readNote(a.id, "run-c"));
    await assert.rejects(
      run(
        patchNote(a.id, "run-c", {
          ...patch,
          revision: reread.revision,
          readToken: reread.readToken!,
          requestId: randomUUID(),
          edits: [
            {
              id: target.id,
              before: target,
              after: { ...target, id: randomUUID() },
            },
          ],
        }),
      ),
      /preserve its block ID/,
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded structured content rejects unsafe links and duplicate identities", () => {
  const decode = Schema.decodeUnknownSync(NoteContent);
  const a = block("<script>alert('text')</script>");
  assert.deepEqual(decode([a]), [a]);
  assert.throws(() => decode([a, a]));
  assert.throws(() => decode([{ ...a, type: "html" }]));
  for (const href of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "https://a.test/\nattack",
  ]) {
    assert.equal(safeNoteUrl(href), false);
    assert.throws(() => decode([{ ...a, content: [{ text: "link", href }] }]));
  }
  assert.equal(safeNoteUrl("https://example.com/path"), true);
  assert.throws(() => decode(Array.from({ length: 501 }, () => block("hi"))));
});

test("three-way recovery preserves unrelated remote edits and refuses overlapping edits or reordered blocks", () => {
  const a = block("A"),
    b = block("B"),
    c = block("C");
  const changedA = { ...a, content: [{ text: "user" }] };
  const changedB = { ...b, content: [{ text: "agent" }] };
  assert.deepEqual(reconcileNote([a, b], [changedA, b], [a, changedB, c]), [
    changedA,
    changedB,
    c,
  ]);
  assert.equal(
    reconcileNote([a], [changedA], [{ ...a, content: [{ text: "other" }] }]),
    null,
  );
  assert.equal(reconcileNote([a, b], [b, a], [a, b]), null);
  assert.deepEqual(reconcileNote([a, b], [a], [a, changedB]), null);
});

test("revision inspection, pagination and no-op saves preserve history and owner isolation", async () => {
  const { readNoteRevision } = await import("../src/server/notes/store.server");
  const directory = mkdtempSync("/tmp/roost-note-history-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const a = await run(
      saveAgent({
        id: randomUUID(),
        name: "History",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const b = await run(
      saveAgent({
        id: randomUUID(),
        name: "Other",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const paragraph = block("Initial");
    const first = await run(
      saveNote(a.id, {
        requestId: randomUUID(),
        revision: 0,
        blocks: [paragraph],
      }),
    );
    const noop = await run(
      saveNote(a.id, {
        requestId: randomUUID(),
        revision: 1,
        blocks: first.blocks,
      }),
    );
    assert.equal(noop.revision, 1);
    const noInstructions = await run(
      saveNoteInstructions(a.id, {
        requestId: randomUUID(),
        revision: 1,
        instructions: "",
      }),
    );
    assert.equal(noInstructions.revision, 1);
    assert.deepEqual(await run(readNoteRevision(a.id, 1)), first);
    await assert.rejects(run(readNoteRevision(b.id, 1)), /not found/);
    for (let revision = 1; revision <= 102; revision++)
      await run(
        saveNote(a.id, {
          requestId: randomUUID(),
          revision,
          blocks: [{ ...paragraph, content: [{ text: String(revision) }] }],
        }),
      );
    const page = await run(noteHistory(a.id));
    assert.equal(page.length, 100);
    assert.equal(page[0]?.revision, 103);
    const older = await run(noteHistory(a.id, page.at(-1)!.revision));
    assert.deepEqual(
      older.map((r) => r.revision),
      [3, 2, 1, 0],
    );
    const token = await run(readNote(a.id, "run"));
    const appended = block("Added");
    const saved = await run(
      patchNote(a.id, "run", {
        revision: token.revision,
        readToken: token.readToken!,
        requestId: randomUUID(),
        edits: [
          {
            id: appended.id,
            before: null,
            after: appended,
            afterId: paragraph.id,
          },
        ],
      }),
    );
    assert.equal(saved.blocks[1]?.id, appended.id);
    const fresh = await run(readNote(a.id, "run"));
    const removed = await run(
      patchNote(a.id, "run", {
        revision: fresh.revision,
        readToken: fresh.readToken!,
        requestId: randomUUID(),
        edits: [{ id: appended.id, before: appended, after: null }],
      }),
    );
    assert.equal(removed.blocks.length, 1);
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
