import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import {
  saveAgent,
  withAgentStore,
} from "../../../src/server/agents/store.server";
import {
  createCodingJob,
  updateCodingJob,
} from "../../../src/server/coding/store.server";
import {
  readCodingWorkspace,
  writeCodingWorkspace,
} from "../../../src/server/coding/workspace-store.server";
import { fixtures } from "./jobs";

const directory = mkdtempSync("/tmp/roost-jobs-app-preview-");
process.env.ROOST_DATA_DIR = directory;
writeFileSync(join(directory, "fixture-only"), "jobs-preview");
mkdirSync(join(directory, "codex"));
const agentId = "11111111-1111-4111-8111-111111111111";
const run = Effect.runPromise;
await run(
  saveAgent({
    id: agentId,
    name: "Roost · test workspace",
    kind: "coding",
    instructions:
      "ISOLATED TEST DATA. Do not run real tools or external actions.",
    character: "moss",
    model: "fake",
  }),
);
const workers: Record<string, unknown> = {};
for (const [index, item] of fixtures.entries()) {
  const id = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
  const workerName = `fixture-${item.id}`;
  const identity = `fixture-owned-${item.id}`;
  await run(
    createCodingJob({
      id,
      agentId,
      title: item.title,
      brief: item.task,
      assignment: item.task,
      cwd: directory,
      sessionName: `fixture-session-${item.id}`,
      workerName,
      workerKind: "codex",
    }),
  );
  await run(
    updateCodingJob(agentId, id, {
      status:
        item.state === "Working"
          ? "running"
          : item.state === "Blocked"
            ? "blocked"
            : item.state === "Completed"
              ? "completed"
              : "review",
      summary: item.update,
      sessionIdentity: identity,
      nativeSessionId: `native-${workerName}`,
      lastWorkerState:
        item.state === "Working"
          ? "working"
          : item.state === "Blocked"
            ? "blocked"
            : "idle",
      observedWorking: true,
      notifiedStatus: item.state === "Blocked" ? "blocked" : "review",
    }),
  );
  await run(
    withAgentStore((db) => {
      const w = readCodingWorkspace(db, agentId, id);
      writeCodingWorkspace(db, {
        ...w,
        previewReportedAt: Date.now(),
        previewExpiresAt: Date.now() + 15 * 60 * 1000,
        workflow:
          item.state === "Ready for feedback"
            ? "feedback"
            : item.state === "Ready for review"
              ? "review"
              : "working",
        previewUrl:
          item.preview === "Not needed"
            ? ""
            : "https://roost-dev.exe.xyz:4322/fixture-preview",
        previewRevision: index === 0 ? "r06" : item.revision,
        previewAvailability:
          item.preview === "Running"
            ? "running"
            : item.preview === "Not needed"
              ? "not_needed"
              : "unavailable",
        latestChanges: item.changes.join("\n"),
        verification: item.pr
          ? "Simulated verification evidence; not a production acceptance claim."
          : "",
        pullRequests: item.pr
          ? ["https://roost-dev.exe.xyz:4322/fixture-preview"]
          : [],
        integration: "pending",
      });
      db.prepare(
        "UPDATE coding_jobs SET createdAt=?,updatedAt=? WHERE id=?",
      ).run(Date.now() - index * 60000, Date.now() - index * 60000, id);
    }),
  );
  workers[workerName] = {
    jobId: id,
    state:
      item.state === "Working"
        ? "working"
        : item.state === "Blocked"
          ? "blocked"
          : "idle",
    until: 0,
    identity,
  };
}
await run(
  withAgentStore((db) => {
    db.prepare("INSERT INTO timeline_imports(agentId) VALUES(?)").run(agentId);
    db.exec("UPDATE agent_reflections SET nextRunAt=NULL");
  }),
);
writeFileSync(join(directory, "workers.json"), JSON.stringify(workers));
// Test provider speaks the existing local fixture protocol and cannot execute a model.
const binary = join(directory, "fake-codex");
writeFileSync(
  binary,
  `#!/bin/sh\nexec '${process.execPath}' '${resolve("tests/fixtures/chat-server.mjs")}'\n`,
  { mode: 0o700 },
);
writeFileSync("/tmp/jobs-app-preview-directory", directory);
console.log(directory);
