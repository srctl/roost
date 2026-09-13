import { Effect } from "effect";
import type { CodingJob, CodingJobPatch } from "../../features/coding/schema";
import { withAgentStore } from "../agents/store.server";
import { isMaintenance } from "../maintenance.server";
import { putMessage } from "../runs/timeline.server";
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
import { checkJobPreview } from "./preview-check.server";
import {
  decodeCodingJob,
  readCodingJob,
  writeCodingJobPatch,
} from "./store.server";
import { readCodingWorkspace } from "./workspace-store.server";

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
        if (!owns(db, owner)) return [];
        const maintaining = isMaintenance(db);
        for (const row of db
          .prepare("SELECT * FROM coding_jobs WHERE status='starting'")
          .all()) {
          db.prepare(
            "UPDATE coding_job_inputs SET status='failed',error='Roost restarted during launch. Inspect the existing session before retrying.' WHERE jobId=? AND status='launching'",
          ).run(String(row.id));
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
            "INSERT OR IGNORE INTO coding_worker_fences(inputId,jobId,agentId,sessionIdentity,nativeSessionId) VALUES(?,?,?,?,?)",
          ).run(
            String(row.inputId),
            String(row.id),
            String(row.agentId),
            String(row.sessionIdentity),
            String(row.nativeSessionId),
          );
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
          .all(
            maintaining
              ? 0
              : Math.max(0, Math.min(4 - active, 4 - stops.length)),
          );
        const monitoring = db
          .prepare(
            "SELECT * FROM coding_jobs WHERE status IN ('running','blocked','review') AND NOT (status='blocked' AND lastWorkerState='not_started') AND cancelRequested=0 AND lastCheckedAt<? ORDER BY lastCheckedAt,createdAt LIMIT ?",
          )
          .all(Date.now() - 4000, 4 - queued.length - stops.length);
        for (const row of [...stops, ...queued, ...monitoring]) {
          const job = decodeCodingJob(row);
          const patch: CodingJobPatch = { lastCheckedAt: Date.now() };
          if (job.status === "queued") {
            Object.assign(patch, { status: "starting", launchOwner: owner });
            db.prepare(
              "UPDATE coding_job_inputs SET status='launching' WHERE jobId=? AND status='launch_queued'",
            ).run(job.id);
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
          const retries = await Effect.runPromise(
            withAgentStore((db) =>
              db
                .prepare(
                  "SELECT prompt FROM coding_job_inputs WHERE jobId=? AND status IN ('launching','launch_failed') ORDER BY createdAt,rowid",
                )
                .all(job.id),
            ),
          );
          const started = await adapter.startCodingWorker(job, {
            cwd: job.cwd,
            workerName: job.workerName,
            workerKind: job.workerKind,
            brief: `${job.brief}${retries.map((retry) => `\nFollow-up:\n${String(retry.prompt)}`).join("")}`,
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
                db.prepare(
                  "UPDATE coding_job_inputs SET status='sent',error='' WHERE jobId=? AND status IN ('launching','launch_failed')",
                ).run(job.id);
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
        // Observe a safe boundary before claiming any input. Herdr's prompt API
        // cannot interrupt a busy turn, and blocked terminals may be approvals.
        const legacyQueued = await Effect.runPromise(
          withAgentStore(
            (db) =>
              !isMaintenance(db) &&
              Boolean(
                db
                  .prepare(
                    "SELECT i.id FROM coding_job_inputs i LEFT JOIN coding_worker_messages m ON m.inputId=i.id WHERE i.id=(SELECT id FROM coding_job_inputs WHERE jobId=? AND status='queued' ORDER BY createdAt,rowid LIMIT 1) AND m.inputId IS NULL AND NOT EXISTS(SELECT 1 FROM coding_worker_messages active JOIN coding_job_inputs a ON a.id=active.inputId WHERE a.jobId=i.jobId AND a.status='sent' AND active.completedAt IS NULL)",
                  )
                  .get(job.id),
              ),
          ),
        );
        // The established coordinator continuation transport also supports
        // explicitly authorized named-server recovery. It performs its own
        // identity/approval/busy guard; do not preempt recovery with a read.
        const observed: HerdrWorker = legacyQueued
          ? {
              state: "idle",
              output: job.output,
              sessionIdentity: job.sessionIdentity,
              nativeSessionId: job.nativeSessionId,
            }
          : await adapter.readCodingWorker(job, job.workerName, signal);
        const sameWorker =
          Boolean(job.sessionIdentity) &&
          observed.sessionIdentity === job.sessionIdentity &&
          (!job.nativeSessionId ||
            observed.nativeSessionId === job.nativeSessionId);
        await Effect.runPromise(
          withAgentStore((db) =>
            writeTransaction(db, () => {
              if (!owns(db, owner) || signal.aborted) return;
              if (!sameWorker || observed.state === "missing") {
                db.prepare(
                  "UPDATE coding_job_inputs SET status='failed',error=? WHERE jobId=? AND status IN ('queued','sent') AND id IN (SELECT inputId FROM coding_worker_messages WHERE completedAt IS NULL)",
                ).run(
                  "The existing worker is missing or its identity changed. Delivery or response could not be reconciled; inspect the original worker before releasing this queue. Unsent messages were not delivered and delivered messages will not be replayed.",
                  job.id,
                );
                return;
              }
              const active = db
                .prepare(
                  "SELECT m.* FROM coding_worker_messages m JOIN coding_job_inputs i ON i.id=m.inputId WHERE m.jobId=? AND i.status='sent' AND m.completedAt IS NULL ORDER BY i.createdAt,i.rowid LIMIT 1",
                )
                .get(job.id);
              if (!active || legacyQueued) return;
              if (observed.state === "working")
                db.prepare(
                  "UPDATE coding_worker_messages SET respondingAt=COALESCE(respondingAt,?) WHERE inputId=?",
                ).run(Date.now(), String(active.inputId));
              if (
                ["idle", "done"].includes(observed.state) &&
                (active.respondingAt ||
                  observed.output !== active.baselineOutput)
              ) {
                const baseline = String(active.baselineOutput);
                const output = observed.output.startsWith(baseline)
                  ? observed.output.slice(baseline.length).trim()
                  : observed.output.trim();
                const responseId = `worker-response:${String(active.inputId)}`;
                putMessage(
                  db,
                  job.agentId,
                  {
                    id: responseId,
                    role: "assistant",
                    title: "Worker response · terminal output",
                    text:
                      output ||
                      "The worker finished this turn without additional captured output. Inspect its terminal for details.",
                    createdAt: Date.now(),
                  },
                  job.id,
                );
                db.prepare(
                  "UPDATE coding_worker_messages SET completedAt=?,responseId=? WHERE inputId=?",
                ).run(Date.now(), responseId, String(active.inputId));
              }
            }),
          ),
        );
        if (!sameWorker || !["idle", "done"].includes(observed.state)) {
          if (!sameWorker) {
            await persist(job, {
              status: "blocked",
              lastWorkerState:
                observed.state === "missing" ? "missing" : "unknown",
              error:
                "The existing worker identity could not be verified. No input was sent.",
            });
            return;
          }
          await recordWorker(job, observed);
          return;
        }
        // Persist the observation before dispatch; coordinator updates can race
        // with I/O, so reacquire the current revision inside the claim below.
        const input = await Effect.runPromise(
          withAgentStore((db) =>
            writeTransaction(db, () => {
              if (!owns(db, owner) || signal.aborted || isMaintenance(db))
                return undefined;
              const current = readCodingJob(db, job.agentId, job.id);
              if (!current || current.cancelRequested) return undefined;
              if (["completed", "cancelled", "failed"].includes(current.status))
                return undefined;
              if (
                db
                  .prepare(
                    "SELECT i.id FROM coding_job_inputs i JOIN coding_worker_messages m ON m.inputId=i.id WHERE i.jobId=? AND i.status='failed'",
                  )
                  .get(job.id)
              )
                return undefined;
              if (
                db
                  .prepare(
                    "SELECT inputId FROM coding_worker_fences WHERE jobId=? AND acknowledgedAt IS NULL",
                  )
                  .get(job.id)
              )
                return undefined;
              // A delivered turn must settle before the next queue item.
              if (
                db
                  .prepare(
                    "SELECT m.inputId FROM coding_worker_messages m JOIN coding_job_inputs i ON i.id=m.inputId WHERE m.jobId=? AND i.status='sent' AND m.completedAt IS NULL",
                  )
                  .get(job.id)
              )
                return undefined;
              const next = db
                .prepare(
                  "SELECT i.id,m.sessionIdentity,m.nativeSessionId FROM coding_job_inputs i LEFT JOIN coding_worker_messages m ON m.inputId=i.id WHERE i.jobId=? AND i.status='queued' ORDER BY i.createdAt,i.rowid LIMIT 1",
                )
                .get(job.id);
              if (
                next?.sessionIdentity &&
                (next.sessionIdentity !== observed.sessionIdentity ||
                  (next.nativeSessionId &&
                    next.nativeSessionId !== observed.nativeSessionId))
              ) {
                db.prepare(
                  "UPDATE coding_job_inputs SET status='failed',error='The message belongs to a different worker identity. No input was sent.' WHERE id=?",
                ).run(String(next.id));
                return undefined;
              }
              if (next)
                db.prepare(
                  "UPDATE coding_worker_messages SET baselineOutput=? WHERE inputId=?",
                ).run(observed.output, String(next.id));
              const row = db
                .prepare(
                  "UPDATE coding_job_inputs SET status='dispatching' WHERE id=(SELECT id FROM coding_job_inputs WHERE jobId=? AND status='queued' ORDER BY createdAt,rowid LIMIT 1) RETURNING *",
                )
                .get(job.id);
              if (row)
                job = writeCodingJobPatch(
                  db,
                  job.agentId,
                  job.id,
                  {
                    launchOwner: owner,
                    // Protect server recovery from an update before the next
                    // worker observation replaces the old "missing" state.
                    lastWorkerState:
                      current.lastWorkerState === "missing"
                        ? "recovering"
                        : current.lastWorkerState,
                  },
                  current.revision,
                );
              return row;
            }),
          ),
        );
        if (input) {
          try {
            if (
              /is the dev server running for this preview/i.test(
                String(input.prompt),
              )
            ) {
              const workspace = await Effect.runPromise(
                withAgentStore((db) =>
                  readCodingWorkspace(db, job.agentId, job.id),
                ),
              );
              const otherWorktrees = await Effect.runPromise(
                withAgentStore((db) =>
                  db
                    .prepare(
                      "SELECT cwd FROM coding_jobs WHERE id<>? AND remoteTarget=''",
                    )
                    .all(job.id)
                    .map((row) => String(row.cwd)),
                ),
              );
              const check = await checkJobPreview(
                job,
                workspace.previewUrl,
                workspace.previewRevision,
                otherWorktrees,
              );
              await Effect.runPromise(
                withAgentStore((db) => {
                  if (!owns(db, owner) || signal.aborted) return;
                  putMessage(
                    db,
                    job.agentId,
                    {
                      id: `preview-check:${String(input.id)}`,
                      role: "notice",
                      title: "Live preview check",
                      text: JSON.stringify(check, null, 2),
                      createdAt: check.checkedAt,
                    },
                    job.id,
                  );
                }),
              );
            }
            const started = await adapter.promptCodingWorker(
              job,
              job.workerName,
              String(input.prompt),
              identity(job),
              signal,
              () => checkSubmission(job),
              job.cwd,
            );
            await Effect.runPromise(
              withAgentStore((db) =>
                writeTransaction(db, () => {
                  if (!owns(db, owner) || signal.aborted) return;
                  db.prepare(
                    "UPDATE coding_worker_messages SET deliveredAt=?,respondingAt=? WHERE inputId=?",
                  ).run(
                    Date.now(),
                    started.state === "working" ? Date.now() : null,
                    String(input.id),
                  );
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
                  if (
                    error instanceof HerdrError &&
                    error.code === "worker_busy" &&
                    !error.uncertain
                  ) {
                    db.prepare(
                      "UPDATE coding_job_inputs SET status='queued',error='' WHERE id=?",
                    ).run(String(input.id));
                    return;
                  }
                  if (!(error instanceof HerdrError) || error.uncertain)
                    db.prepare(
                      "INSERT OR IGNORE INTO coding_worker_fences(inputId,jobId,agentId,sessionIdentity,nativeSessionId) VALUES(?,?,?,?,?)",
                    ).run(
                      String(input.id),
                      job.id,
                      job.agentId,
                      job.sessionIdentity,
                      job.nativeSessionId,
                    );
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
        await recordWorker(job, observed);
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
        ) {
          const neverStarted =
            original.status === "starting" &&
            error instanceof HerdrError &&
            error.stage === "prepare" &&
            !error.uncertain &&
            error.code !== "already_exists" &&
            current.dispatchedAt === null &&
            !current.observedWorking &&
            !current.sessionIdentity &&
            !current.nativeSessionId &&
            !current.paneId;
          if (original.status === "starting")
            await Effect.runPromise(
              withAgentStore((db) => {
                if (!owns(db, owner) || signal.aborted) return;
                db.prepare(
                  "UPDATE coding_job_inputs SET status=?,error=? WHERE jobId=? AND status='launching'",
                ).run(
                  neverStarted ? "launch_failed" : "failed",
                  message(error),
                  job.id,
                );
              }),
            );
          await persist(current, {
            status: "blocked",
            error: message(error),
            ...(neverStarted ? { lastWorkerState: "not_started" } : {}),
            ...(current.cancelRequested &&
            error instanceof HerdrError &&
            error.code === "identity_changed"
              ? { cancelRequested: false }
              : {}),
          });
        }
      }
    }),
  );
  if (outcomes.some((result) => result.status === "rejected"))
    throw new Error(
      "Could not persist a coding job outcome; the next tick will inspect it without replaying its assignment.",
    );
}
