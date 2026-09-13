import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import type { Message } from "../../features/chat/schema";
import {
  CodingWorkspace,
  type JobFeedback,
  JobFeedbackInput,
} from "../../features/coding/workspace-schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import { putMessage } from "../runs/timeline.server";
import { writeTransaction } from "../transaction.server";
import { readCodingJob, requireCodingAgent } from "./store.server";

export function requireWorkspaceJob(
  db: DatabaseSync,
  agentId: string,
  id: string,
) {
  requireCodingAgent(db, agentId);
  const job = readCodingJob(db, agentId, id);
  if (!job) throw new AgentStoreError({ message: "Coding job not found." });
  return job;
}

export function readCodingWorkspace(
  db: DatabaseSync,
  agentId: string,
  jobId: string,
): CodingWorkspace {
  const row = db
    .prepare("SELECT * FROM coding_job_workspaces WHERE jobId=? AND agentId=?")
    .get(jobId, agentId);
  return row
    ? Schema.decodeUnknownSync(CodingWorkspace)({
        ...JSON.parse(String(row.data)),
        ...row,
      })
    : {
        jobId,
        agentId,
        conversationId: agentId,
        revision: 0,
        updatedAt: 0,
        workflow: "working",
        previewUrl: "",
        previewRevision: "",
        previewAvailability: "unavailable",
        latestChanges: "",
        verification: "",
        integration: "pending",
        pullRequests: [],
      };
}

export function writeCodingWorkspace(
  db: DatabaseSync,
  workspace: CodingWorkspace,
) {
  const next = {
    ...workspace,
    revision: workspace.revision + 1,
    updatedAt: Date.now(),
  };
  db.prepare(`INSERT INTO coding_job_workspaces(jobId,agentId,conversationId,data,revision,updatedAt)
    VALUES(?,?,?,?,?,?) ON CONFLICT(jobId) DO UPDATE SET data=excluded.data,revision=excluded.revision,updatedAt=excluded.updatedAt`).run(
    next.jobId,
    next.agentId,
    next.conversationId,
    JSON.stringify(next),
    next.revision,
    next.updatedAt,
  );
  return next;
}

export function readJobFeedback(
  db: DatabaseSync,
  agentId: string,
  jobId: string,
): JobFeedback[] {
  // Content is owned by the existing message timeline, never copied into a
  // parallel conversation store. Main conversation is the v10 adapter.
  return db
    .prepare(`SELECT f.*,t.message,i.status AS delivery,i.error FROM coding_job_feedback f
    JOIN timeline t ON t.id=f.messageId AND t.agentId=f.agentId
    LEFT JOIN coding_job_inputs i ON i.id=f.inputId AND i.jobId=f.jobId AND i.agentId=f.agentId
    WHERE f.agentId=? AND f.jobId=? ORDER BY f.createdAt,f.rowid LIMIT 200`)
    .all(agentId, jobId)
    .map((row) => ({
      id: String(row.messageId),
      text: (JSON.parse(String(row.message)) as Message & { text: string })
        .text,
      previewRevision: String(row.previewRevision),
      createdAt: Number(row.createdAt),
      inputId: row.inputId ? String(row.inputId) : null,
      delivery: row.delivery ? String(row.delivery) : null,
      error: String(row.error ?? ""),
    }));
}

export const getJobWorkspace = (agentId: string, id: string) =>
  withAgentStore((db) => {
    requireWorkspaceJob(db, agentId, id);
    return {
      workspace: readCodingWorkspace(db, agentId, id),
      feedback: readJobFeedback(db, agentId, id),
    };
  });

export const saveJobFeedback = (input: typeof JobFeedbackInput.Type) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const data = Schema.decodeUnknownSync(JobFeedbackInput)(input);
      const job = requireWorkspaceJob(db, data.agentId, data.id);
      const prior = db
        .prepare(
          `SELECT f.*,t.message FROM coding_job_feedback f JOIN timeline t ON t.id=f.messageId WHERE f.messageId=?`,
        )
        .get(data.requestId);
      if (prior) {
        if (
          prior.jobId !== data.id ||
          prior.agentId !== data.agentId ||
          prior.previewRevision !== data.previewRevision ||
          JSON.parse(String(prior.message)).text !== data.text
        )
          throw new AgentStoreError({
            message:
              "This feedback request ID was already used for different content.",
          });
        return { id: data.requestId };
      }
      if (db.prepare("SELECT id FROM timeline WHERE id=?").get(data.requestId))
        throw new AgentStoreError({
          message: "This message ID already exists.",
        });
      const count = Number(
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM coding_job_feedback WHERE jobId=?",
          )
          .get(job.id)!.n,
      );
      if (count >= 200)
        throw new AgentStoreError({
          message:
            "This job has reached the feedback limit. Continue in the agent conversation.",
        });
      // Saving is a notice, not a user turn: it must not steer or enqueue a run.
      putMessage(db, data.agentId, {
        id: data.requestId,
        role: "notice",
        title: `Saved feedback · ${job.title}`,
        text: data.text,
      });
      db.prepare(
        "INSERT INTO coding_job_feedback(messageId,jobId,agentId,previewRevision,createdAt) VALUES(?,?,?,?,?)",
      ).run(
        data.requestId,
        job.id,
        data.agentId,
        data.previewRevision,
        Date.now(),
      );
      return { id: data.requestId };
    }),
  );

export function assertFeedbackMayResume(
  db: DatabaseSync,
  agentId: string,
  jobId: string,
  runId: string,
) {
  const workspace = readCodingWorkspace(db, agentId, jobId);
  if (workspace.workflow !== "feedback") return;
  const run = db
    .prepare("SELECT kind,createdAt FROM runs WHERE id=? AND agentId=?")
    .get(runId, agentId);
  if (run?.kind !== "chat" || Number(run.createdAt) < workspace.updatedAt)
    throw new AgentStoreError({
      message:
        "This job is waiting for user feedback. A new user turn or explicit Jobs continuation is required.",
    });
}
