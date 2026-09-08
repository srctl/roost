import { Effect } from "effect";
import type { CodingJob, CodingJobPatch } from "../../features/coding/schema";
import { withAgentStore } from "../agents/store.server";
import { isMaintenance } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";
import {
  HerdrError,
  type HerdrWorker,
  promptCodingWorker,
  readCodingWorker,
  startCodingWorker,
  stopCodingWorker,
} from "./herdr.server";
import { changeCodingJob } from "./jobs.server";
import {
  decodeCodingJob,
  readCodingJob,
  writeCodingJobPatch,
} from "./store.server";

export const codingAdapter = {
  startCodingWorker,
  readCodingWorker,
  promptCodingWorker,
  stopCodingWorker,
};
type Adapter = typeof codingAdapter;

const owns = (db: import("node:sqlite").DatabaseSync, owner: string) =>
  !!db
    .prepare("SELECT id FROM worker_lease WHERE owner=? AND heartbeat>?")
    .get(owner, Date.now() - 30000);

const message = (error: unknown) =>
  error instanceof HerdrError
    ? error.message
    : "Could not inspect this coding session. Its task was not automatically resubmitted.";

const identity = (job: CodingJob) =>
  job.sessionIdentity
    ? `${job.sessionIdentity}${job.nativeSessionId ? `|session:${job.nativeSessionId}` : ""}`
    : undefined;

// Job polling is independent of the scheduler heartbeat and conversational
// slots. Shell operations must never hold the global worker lease transaction.
export async function tickCodingJobs(
  owner: string,
  signal: AbortSignal,
  adapter: Adapter = codingAdapter,
) {
  const jobs = await Effect.runPromise(
    withAgentStore((db) =>
      writeTransaction(db, () => {
        if (!owns(db, owner) || isMaintenance(db)) return [];
        for (const row of db
          .prepare("SELECT * FROM coding_jobs WHERE status='starting'")
          .all()) {
          changeCodingJob(db, decodeCodingJob(row), {
            status: "blocked",
            error:
              "Roost restarted while starting this worker. Inspect the existing session before continuing; the assignment was not resubmitted.",
          });
        }
        for (const row of db
          .prepare(
            "SELECT i.id AS inputId,j.* FROM coding_job_inputs i JOIN coding_jobs j ON j.id=i.jobId WHERE i.status='dispatching'",
          )
          .all()) {
          db.prepare(
            "UPDATE coding_job_inputs SET status='failed',error=? WHERE id=?",
          ).run(
            "Roost restarted during submission. Inspect the existing worker before retrying.",
            String(row.inputId),
          );
          changeCodingJob(db, decodeCodingJob(row), {
            status: "blocked",
            error:
              "Roost restarted while submitting a follow-up. It was not sent again automatically.",
          });
        }
        const active = Number(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM coding_jobs WHERE status IN ('starting','running')",
            )
            .get()?.count,
        );
        const selected: CodingJob[] = [];
        const stops = db
          .prepare(
            "SELECT * FROM coding_jobs WHERE cancelRequested=1 AND status IN ('running','blocked','review') ORDER BY lastCheckedAt,createdAt LIMIT 4",
          )
          .all();
        const queued = db
          .prepare(
            "SELECT * FROM coding_jobs WHERE status='queued' ORDER BY createdAt LIMIT ?",
          )
          .all(Math.max(0, Math.min(4 - active, 4 - stops.length)));
        const monitoring = db
          .prepare(
            "SELECT * FROM coding_jobs WHERE status IN ('running','blocked','review') AND cancelRequested=0 AND lastCheckedAt<? ORDER BY lastCheckedAt,createdAt LIMIT ?",
          )
          .all(Date.now() - 4000, 4 - queued.length - stops.length);
        for (const row of [...stops, ...queued, ...monitoring]) {
          const job = decodeCodingJob(row);
          const patch: CodingJobPatch = { lastCheckedAt: Date.now() };
          if (job.status === "queued") {
            Object.assign(patch, { status: "starting", launchOwner: owner });
          }
          // lastCheckedAt is housekeeping, so an idle poll must not invalidate the
          // review revision a user/coordinator has just read.
          db.prepare("UPDATE coding_jobs SET lastCheckedAt=? WHERE id=?").run(
            patch.lastCheckedAt!,
            job.id,
          );
          selected.push(
            job.status === "queued"
              ? writeCodingJobPatch(
                  db,
                  job.agentId,
                  job.id,
                  { status: "starting", launchOwner: owner },
                  job.revision,
                )
              : { ...job, lastCheckedAt: patch.lastCheckedAt! },
          );
        }
        return selected;
      }),
    ),
  );

  const persist = async (job: CodingJob, patch: CodingJobPatch) =>
    Effect.runPromise(
      withAgentStore((db) =>
        writeTransaction(db, () => {
          if (!owns(db, owner) || signal.aborted) return null;
          const current = readCodingJob(db, job.agentId, job.id);
          if (!current || current.revision !== job.revision) return null;
          return changeCodingJob(db, current, patch);
        }),
      ),
    );

  const checkSubmission = async (job: CodingJob) => {
    const allowed = await Effect.runPromise(
      withAgentStore((db) => {
        const current = readCodingJob(db, job.agentId, job.id);
        return (
          !signal.aborted &&
          owns(db, owner) &&
          !isMaintenance(db) &&
          current &&
          !current.cancelRequested &&
          !["completed", "cancelled", "failed"].includes(current.status)
        );
      }),
    );
    if (!allowed)
      throw new HerdrError(
        "The job was stopped before submission. Inspect its session before continuing.",
        "cancelled",
        "prompt",
      );
  };

  const recordWorker = async (job: CodingJob, worker: HerdrWorker) => {
    if (
      job.sessionIdentity &&
      worker.sessionIdentity &&
      (job.sessionIdentity !== worker.sessionIdentity ||
        (job.nativeSessionId && job.nativeSessionId !== worker.nativeSessionId))
    )
      return persist(job, {
        status: "blocked",
        error:
          "This terminal now belongs to a different worker. No input was sent; inspect it in Herdr.",
      });
    if (worker.state === "missing")
      return persist(job, {
        status: "blocked",
        error:
          "The coding worker is missing. Its assignment was not restarted automatically.",
        lastWorkerState: "missing",
      });
    const observedWorking = job.observedWorking || worker.state === "working";
    const status =
      worker.state === "working"
        ? "running"
        : worker.state === "blocked"
          ? "blocked"
          : (worker.state === "idle" || worker.state === "done") &&
              observedWorking
            ? "review"
            : job.status;
    return persist(job, {
      status,
      output: worker.output,
      observedWorking,
      sessionIdentity: worker.sessionIdentity ?? job.sessionIdentity,
      nativeSessionId: worker.nativeSessionId ?? job.nativeSessionId,
      paneId: worker.paneId ?? job.paneId,
      lastWorkerState: worker.state,
      error:
        status === "blocked"
          ? worker.state === "blocked"
            ? "The worker needs your attention in its Herdr terminal."
            : job.error
          : "",
      ...(status === "running" ? { notifiedStatus: "" } : {}),
    });
  };

  const outcomes = await Promise.allSettled(
    jobs.map(async (original) => {
      let job = original;
      try {
        if (signal.aborted) return;
        if (job.cancelRequested) {
          let sentNow = false;
          if (job.lastWorkerState !== "interrupt_sent") {
            const before = await adapter.readCodingWorker(
              job,
              job.workerName,
              signal,
            );
            if (before.state === "missing") {
              await persist(job, {
                status: "cancelled",
                error: "Stopped. The worker is no longer running.",
              });
              return;
            }
            if (
              job.sessionIdentity &&
              (before.sessionIdentity !== job.sessionIdentity ||
                (job.nativeSessionId &&
                  job.nativeSessionId !== before.nativeSessionId))
            )
              throw new HerdrError(
                "The worker identity changed. The stop was not sent; inspect the terminal.",
                "identity_changed",
                "stop",
              );
            // Record dispatch before I/O so a lost reply/restart cannot send
            // a second interrupt into a different terminal interaction.
            const sent = await persist(job, {
              lastWorkerState: "interrupt_sent",
              error:
                "Interrupt requested. Waiting for the coding worker to stop.",
            });
            if (!sent) return;
            job = sent;
            sentNow = true;
            await adapter.stopCodingWorker(
              job,
              job.workerName,
              identity(job),
              signal,
            );
          }
          const after = await adapter.readCodingWorker(
            job,
            job.workerName,
            signal,
          );
          if (
            after.state !== "missing" &&
            job.sessionIdentity &&
            (after.sessionIdentity !== job.sessionIdentity ||
              (job.nativeSessionId &&
                after.nativeSessionId !== job.nativeSessionId))
          )
            throw new HerdrError(
              "The worker identity changed after the interrupt. Inspect the terminal to confirm it stopped.",
              "identity_changed",
              "stop",
            );
          if (["idle", "done", "blocked", "missing"].includes(after.state))
            await persist(job, {
              status: "cancelled",
              error:
                "Stopped. The session, worktree, and infrastructure were preserved.",
              output: after.output,
            });
          else if (!sentNow)
            await persist(job, {
              status: "blocked",
              cancelRequested: false,
              lastWorkerState: after.state,
              error:
                "The worker is still active after the interrupt request. Inspect its terminal before requesting another stop.",
            });
          return;
        }
        if (job.status === "starting") {
          const started = await adapter.startCodingWorker(job, {
            cwd: job.cwd,
            workerName: job.workerName,
            workerKind: job.workerKind,
            brief: job.brief,
            signal,
            beforeSend: () => checkSubmission(job),
          });
          // A stop can arrive during startup. Preserve it while recording the
          // identity needed to interrupt exactly this worker on the next tick.
          await Effect.runPromise(
            withAgentStore((db) =>
              writeTransaction(db, () => {
                if (!owns(db, owner) || signal.aborted) return;
                const current = readCodingJob(db, job.agentId, job.id);
                if (current?.status !== "starting") return;
                changeCodingJob(db, current, {
                  status: started.state === "blocked" ? "blocked" : "running",
                  observedWorking: started.state === "working",
                  dispatchedAt: Date.now(),
                  sessionIdentity: started.sessionIdentity ?? "",
                  nativeSessionId: started.nativeSessionId ?? "",
                  paneId: started.paneId ?? "",
                  lastWorkerState: started.state,
                  error:
                    started.state === "blocked"
                      ? "The worker needs your attention in its Herdr terminal."
                      : "",
                });
              }),
            ),
          );
          return;
        }
        const input = await Effect.runPromise(
          withAgentStore((db) =>
            writeTransaction(db, () => {
              if (!owns(db, owner) || signal.aborted || isMaintenance(db))
                return undefined;
              const current = readCodingJob(db, job.agentId, job.id);
              if (!current || current.cancelRequested) return undefined;
              const row = db
                .prepare(
                  "UPDATE coding_job_inputs SET status='dispatching' WHERE id=(SELECT id FROM coding_job_inputs WHERE jobId=? AND status='queued' ORDER BY createdAt LIMIT 1) RETURNING *",
                )
                .get(job.id);
              if (row)
                job = writeCodingJobPatch(
                  db,
                  job.agentId,
                  job.id,
                  { launchOwner: owner },
                  current.revision,
                );
              return row;
            }),
          ),
        );
        if (input) {
          try {
            const started = await adapter.promptCodingWorker(
              job,
              job.workerName,
              String(input.prompt),
              identity(job),
              signal,
              () => checkSubmission(job),
            );
            await Effect.runPromise(
              withAgentStore((db) =>
                writeTransaction(db, () => {
                  if (!owns(db, owner) || signal.aborted) return;
                  db.prepare(
                    "UPDATE coding_job_inputs SET status='sent' WHERE id=?",
                  ).run(String(input.id));
                  const current = readCodingJob(db, job.agentId, job.id);
                  if (current)
                    changeCodingJob(db, current, {
                      status:
                        started.state === "blocked" ? "blocked" : "running",
                      observedWorking: started.state === "working",
                      dispatchedAt: Date.now(),
                      lastWorkerState: started.state,
                      error:
                        started.state === "blocked"
                          ? "The worker needs your attention in its Herdr terminal."
                          : "",
                    });
                }),
              ),
            );
          } catch (error) {
            await Effect.runPromise(
              withAgentStore((db) =>
                writeTransaction(db, () => {
                  if (!owns(db, owner) || signal.aborted) return;
                  db.prepare(
                    "UPDATE coding_job_inputs SET status='failed',error=? WHERE id=?",
                  ).run(message(error), String(input.id));
                  const current = readCodingJob(db, job.agentId, job.id);
                  if (current)
                    changeCodingJob(db, current, {
                      status: "blocked",
                      error: message(error),
                    });
                }),
              ),
            );
          }
          return;
        }
        await recordWorker(
          job,
          await adapter.readCodingWorker(job, job.workerName, signal),
        );
      } catch (error) {
        if (signal.aborted) return;
        // Refresh only the revision: cancellation may have arrived during a
        // failed launch. No failure path resubmits a prompt or creates a session.
        const current = await Effect.runPromise(
          withAgentStore((db) => readCodingJob(db, job.agentId, job.id)),
        );
        if (
          current &&
          !["completed", "cancelled", "failed"].includes(current.status)
        )
          await persist(current, {
            status: "blocked",
            error: message(error),
            ...(current.cancelRequested &&
            error instanceof HerdrError &&
            error.code === "identity_changed"
              ? { cancelRequested: false }
              : {}),
          });
      }
    }),
  );
  if (outcomes.some((result) => result.status === "rejected"))
    throw new Error(
      "Could not persist a coding job outcome; the next tick will inspect it without replaying its assignment.",
    );
}
