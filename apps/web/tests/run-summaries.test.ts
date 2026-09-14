import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { withAgentStore } from "../src/server/agents/store.server";
import {
  type RunSummary,
  readRunSummaries,
} from "../src/server/runs/store.server";

test("run summaries bound history and payloads while preserving snapshot names and agent isolation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-run-summaries-"));
  try {
    await Effect.runPromise(
      withAgentStore((db) => {
        const automation = db.prepare(
          "INSERT INTO automations (id,agentId,name,prompt,schedule,notification,revision,enabled) VALUES (?,'a',?,'Check updates','{}','always',1,1)",
        );
        automation.run("renamed", "Original name");
        automation.run("deleted", "Deleted automation");
        const insert = db.prepare(
          "INSERT INTO runs (id,agentId,kind,prompt,status,createdAt,automationId,automationSnapshot,messages) VALUES (?,'a',?,?,?,?,?,?,?)",
        );
        const largePrompt = "p".repeat(100_000);
        const largeMessages = JSON.stringify([
          { id: "result", role: "assistant", text: "x".repeat(1_000_000) },
        ]);
        const largeSnapshot = JSON.stringify({
          id: "renamed",
          name: "Original name",
          prompt: largePrompt,
        });
        const expected: RunSummary[] = [];
        const kinds = ["chat", "automation", "delegation", "handoff"] as const;
        for (let i = 0; i < 55; i++) {
          const kind = kinds[i % kinds.length];
          const automationName =
            kind !== "automation"
              ? null
              : i === 49
                ? "Deleted automation"
                : "Original name";
          const snapshot =
            kind !== "automation"
              ? null
              : i === 53
                ? largeSnapshot
                : JSON.stringify({ name: automationName });
          const summary = {
            id: `a-${i}`,
            kind,
            status: i === 54 ? "queued" : "completed",
            createdAt: i,
            automationName,
          };
          expected.push(summary);
          insert.run(
            summary.id,
            kind,
            i === 53 ? largePrompt : "Check updates",
            summary.status,
            summary.createdAt,
            kind === "automation" ? (i === 49 ? "deleted" : "renamed") : null,
            snapshot,
            i === 53 ? largeMessages : "[]",
          );
        }
        db.exec("UPDATE automations SET name='New name' WHERE id='renamed'");
        db.exec("DELETE FROM automations WHERE id='deleted'");
        db.exec(
          "INSERT INTO runs (id,agentId,kind,prompt,status,createdAt) VALUES ('other','b','chat','Private','completed',1000)",
        );

        assert.deepEqual(
          readRunSummaries(db, "a").map((summary) => ({ ...summary })),
          expected.reverse().slice(0, 50),
        );
        assert.deepEqual(
          readRunSummaries(db, "b").map((summary) => ({ ...summary })),
          [
            {
              id: "other",
              kind: "chat",
              status: "completed",
              createdAt: 1000,
              automationName: null,
            },
          ],
        );
        assert.equal(
          db
            .prepare("SELECT count(*) AS count FROM runs WHERE agentId='a'")
            .get()?.count,
          55,
        );
        assert.deepEqual(
          {
            ...db
              .prepare(
                "SELECT prompt,messages,automationSnapshot FROM runs WHERE id='a-53'",
              )
              .get(),
          },
          {
            prompt: largePrompt,
            messages: largeMessages,
            automationSnapshot: largeSnapshot,
          },
        );
      }, directory),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
