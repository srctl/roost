import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { mergeEntries } from "../src/features/chat/timeline";
import { withAgentStore } from "../src/server/agents/store.server";
import {
  putMessage,
  readTimelinePage,
} from "../src/server/runs/timeline.server";

test("timeline pages preserve history, incremental edits, bounded outputs and agent isolation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-timeline-"));
  try {
    await Effect.runPromise(
      withAgentStore((db) => {
        for (let i = 0; i < 150; i++)
          putMessage(db, "a", {
            id: `a-${i}`,
            role: "assistant",
            text: `Message ${i}`,
          });
        putMessage(db, "b", { id: "other", role: "user", text: "Private" });
        const page = readTimelinePage(db, "a");
        assert.equal(page.entries.length, 60);
        assert.equal(page.entries[0].message.id, "a-90");
        assert.deepEqual(
          readTimelinePage(db, "a", { since: page.revision }).entries,
          [],
        );
        const old = readTimelinePage(db, "a", { before: page.before! });
        const first = readTimelinePage(db, "a", { before: old.before! });
        assert.equal(first.before, null);
        assert.equal(
          mergeEntries(first.entries, mergeEntries(old.entries, page.entries))
            .length,
          150,
        );
        putMessage(db, "a", { id: "a-149", role: "assistant", text: "Edited" });
        putMessage(db, "a", {
          id: "large",
          role: "activity",
          text: "x".repeat(1_000_000),
          details: "y".repeat(3000),
        });
        const changes = readTimelinePage(db, "a", { since: page.revision });
        assert.deepEqual(
          changes.entries.map((e) => e.message.id),
          ["a-149", "large"],
        );
        assert.equal(changes.entries[1].message.text.length, 2000);
        assert.equal(changes.entries[1].message.details?.length, 2000);
        assert.equal(changes.entries[1].message.truncated, true);
        assert.equal(
          JSON.parse(
            String(
              db.prepare("SELECT message FROM timeline WHERE id='large'").get()!
                .message,
            ),
          ).text.length,
          1_000_000,
        );
        const merged = mergeEntries(page.entries, changes.entries);
        assert.equal(merged.length, 61);
        assert.equal(merged.at(-2)!.message.text, "Edited");
        assert.equal(mergeEntries(merged, []), merged);
        putMessage(db, "a", { id: "a-149", role: "assistant", text: "Edited" });
        assert.deepEqual(
          readTimelinePage(db, "a", { since: changes.revision }).entries,
          [],
        );
        for (let i = 0; i < 130; i++)
          putMessage(db, "a", { id: `new-${i}`, role: "user", text: "New" });
        const batch1 = readTimelinePage(db, "a", { since: changes.revision });
        const batch2 = readTimelinePage(db, "a", { since: batch1.revision });
        const batch3 = readTimelinePage(db, "a", { since: batch2.revision });
        assert.equal(
          batch1.entries.length + batch2.entries.length + batch3.entries.length,
          130,
        );
        assert.deepEqual(
          readTimelinePage(db, "a", { since: batch3.revision }).entries,
          [],
        );
        assert.equal(readTimelinePage(db, "b").entries.length, 1);
      }, directory),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
