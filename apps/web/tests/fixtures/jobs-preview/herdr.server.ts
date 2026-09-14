// Test-only transport, installed solely by jobs-preview/vite.config.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  HerdrTarget,
  HerdrWorker,
} from "../../../src/server/coding/herdr.server";
import {
  readCodingWorkspace,
  writeCodingWorkspace,
} from "../../../src/server/coding/workspace-store.server";

export class HerdrError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly stage: string,
    readonly uncertain = false,
  ) {
    super(message);
  }
}
function directory() {
  const dir = process.env.ROOST_DATA_DIR;
  if (
    !dir?.startsWith("/tmp/roost-jobs-app-preview-") ||
    readFileSync(join(dir, "fixture-only"), "utf8") !== "jobs-preview"
  )
    throw new Error("Refusing non-fixture data directory");
  return dir;
}
function state() {
  return JSON.parse(
    readFileSync(join(directory(), "workers.json"), "utf8"),
  ) as Record<
    string,
    {
      jobId: string;
      state: HerdrWorker["state"];
      until: number;
      identity: string;
    }
  >;
}
function persist(workers: ReturnType<typeof state>) {
  writeFileSync(join(directory(), "workers.json"), JSON.stringify(workers));
}
export async function readCodingWorker(
  _target: HerdrTarget,
  name: string,
): Promise<HerdrWorker> {
  const workers = state();
  const worker = workers[name];
  if (!worker)
    return {
      state: "missing",
      output: "Unknown fixture worker",
      sessionIdentity: null,
    };
  if (worker.until && Date.now() > worker.until) {
    worker.state = "idle";
    worker.until = 0;
    persist(workers);
    const db = new DatabaseSync(join(directory(), "roost.sqlite"));
    try {
      const job = db
        .prepare("SELECT agentId FROM coding_jobs WHERE id=?")
        .get(worker.jobId)!;
      const w = readCodingWorkspace(db, String(job.agentId), worker.jobId);
      writeCodingWorkspace(db, {
        ...w,
        previewReportedAt: Date.now(),
        previewExpiresAt: Date.now() + 15 * 60 * 1000,
        workflow: "feedback",
        previewRevision: `demo-${Date.now().toString(36)}`,
        latestChanges:
          "Simulated revision ready. Feedback was delivered to the same fixture worker; no external process ran.",
      });
    } finally {
      db.close();
    }
  }
  return {
    state: worker.state,
    output:
      "SIMULATED WORKER. No shell, external agent or repository mutation.\nThe Jobs UI and persistence are real; worker effects are test doubles.",
    sessionIdentity: worker.identity,
    nativeSessionId: `native-${name}`,
    paneId: `pane-${name}`,
  };
}
export async function startCodingWorker(): Promise<HerdrWorker> {
  throw new HerdrError(
    "New worker launches are disabled in this isolated preview",
    "fixture_only",
    "prepare",
  );
}
export async function promptCodingWorker(
  target: HerdrTarget,
  name: string,
  _brief: string,
  expected?: string,
  _signal?: AbortSignal,
  beforeSend?: () => Promise<void>,
): Promise<HerdrWorker> {
  const workers = state(),
    worker = workers[name];
  if (!worker || !expected?.startsWith(worker.identity))
    throw new HerdrError(
      "Fixture identity mismatch",
      "identity_changed",
      "prompt",
    );
  await beforeSend?.();
  worker.state = "working";
  worker.until = Date.now() + 10000;
  persist(workers);
  return readCodingWorker(target, name);
}
export async function stopCodingWorker(
  _target: HerdrTarget,
  name: string,
  expected?: string,
) {
  const workers = state(),
    worker = workers[name];
  if (!worker || !expected?.startsWith(worker.identity))
    throw new Error("Fixture identity mismatch");
  worker.state = "idle";
  worker.until = 0;
  persist(workers);
}
