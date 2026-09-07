import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { listAgents, saveAgent } from "../src/server/agents/store.server";

test("agents persist across connections; identical retries reuse the record and conflicting retries fail", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-store-"));
  try {
    const input = {
      id: randomUUID(),
      name: " Scout ",
      instructions: "Research options",
      character: "moss" as const,
      model: "test-model",
    };
    const agent = await Effect.runPromise(saveAgent(input, directory));
    assert.equal(agent.name, "Scout");
    assert.ok(statSync(join(directory, "workspaces", input.id)).isDirectory());
    assert.deepEqual(
      await Effect.runPromise(saveAgent(input, directory)),
      agent,
    );
    await assert.rejects(
      Effect.runPromise(saveAgent({ ...input, name: "Changed" }, directory)),
      /already used/,
    );
    const second = await Effect.runPromise(
      saveAgent({ ...input, id: randomUUID(), name: "Second" }, directory),
    );
    assert.deepEqual(await Effect.runPromise(listAgents(directory)), [
      agent,
      second,
    ]);
    await assert.rejects(
      Effect.runPromise(saveAgent({ ...input, id: "../outside" }, directory)),
    );
    assert.equal((await Effect.runPromise(listAgents(directory))).length, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
