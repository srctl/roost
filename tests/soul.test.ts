import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { saveAgent } from "../src/server/agents/store.server";
import {
  readAgentMemory,
  readSoul,
  updateSoul,
  patchSoul,
  listSoulChanges,
  undoSoulChange,
} from "../src/server/agents/soul.server";

test("souls persist independently, reject stale writes, and never read another agent's memory", async () => {
  const directory = mkdtempSync("/tmp/roost-soul-test-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const create = (name: string) =>
      Effect.runPromise(
        saveAgent({
          id: randomUUID(),
          name,
          instructions: `Help ${name}`,
          character: "moss",
          model: "fake",
        }),
      );

    const a = await create("Scout");
    const b = await create("Wisp");
    const initial = await Effect.runPromise(readSoul(a.id));
    assert.match(initial.content, /Help Scout/);
    assert.match(initial.content, /Memories contain what you have learned/);
    const saved = await Effect.runPromise(
      updateSoul({
        agentId: a.id,
        revision: initial.revision,
        content: "# Scout\nBe direct.",
      }),
    );
    assert.equal(
      (await Effect.runPromise(readSoul(a.id))).content,
      saved.content,
    );
    assert.equal(
      readFileSync(
        join(
          directory,
          "agents",
          a.id,
          "soul-history",
          `${initial.revision}.md`,
        ),
        "utf8",
      ),
      initial.content,
    );
    await assert.rejects(
      Effect.runPromise(
        updateSoul({
          agentId: a.id,
          revision: initial.revision,
          content: "stale",
        }),
      ),
      /changed while/,
    );
    await assert.rejects(
      Effect.runPromise(
        updateSoul({ agentId: a.id, revision: saved.revision, content: " " }),
      ),
      /1–16,000/,
    );
    assert.match(
      (await Effect.runPromise(readSoul(b.id))).content,
      /Help Wisp/,
    );
    await assert.rejects(
      Effect.runPromise(readSoul("../../outside")),
      /Agent not found/,
    );
    const patched = await Effect.runPromise(
      patchSoul(a.id, {
        revision: saved.revision,
        reason: "User asked for warmth",
        edits: [{ before: "Be direct.", after: "Be direct and warm." }],
      }),
    );
    assert.equal(patched.content, "# Scout\nBe direct and warm.");
    const changes = await Effect.runPromise(listSoulChanges(a.id));
    assert.equal(changes[0]?.source, "agent");
    assert.equal(changes[0]?.before, saved.content);
    await assert.rejects(
      Effect.runPromise(undoSoulChange(b.id, changes[0]!.id)),
      /not found/,
    );
    await assert.rejects(
      Effect.runPromise(undoSoulChange(a.id, changes[1]!.id)),
      /changed while/,
    );
    const undone = await Effect.runPromise(
      undoSoulChange(a.id, changes[0]!.id),
    );
    assert.equal(undone.content, saved.content);
    await assert.rejects(
      Effect.runPromise(
        patchSoul(a.id, {
          revision: undone.revision,
          reason: "No match",
          edits: [{ before: "missing", after: "new" }],
        }),
      ),
      /exact passage/,
    );
    const memoryPath = join(directory, "agents", a.id, "codex", "memories");
    mkdirSync(memoryPath, { recursive: true });
    writeFileSync(join(memoryPath, "MEMORY.md"), "Scout-only memory");
    assert.deepEqual(await Effect.runPromise(readAgentMemory(a.id)), [
      { name: "MEMORY.md", content: "Scout-only memory" },
    ]);
    assert.deepEqual(await Effect.runPromise(readAgentMemory(b.id)), []);
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
