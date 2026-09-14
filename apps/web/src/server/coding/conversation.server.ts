import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import {
  isPreviewStatusQuestion,
  WorkerMessageInput,
} from "../../features/coding/workspace-schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import { requireConversation } from "../runs/threads.server";
import { putMessage } from "../runs/timeline.server";
import { writeTransaction } from "../transaction.server";
import { responseCaptureInstruction } from "./response-capture.server";
import {
  readCodingWorkspace,
  requireWorkspaceJob,
  writeCodingWorkspace,
} from "./workspace-store.server";

// All direct and coordinator inputs share one ordered dispatch queue. Message
// content stays in the existing job timeline; this table owns only receipts.
export function readWorkerMessages(
  db: DatabaseSync,
  agentId: string,
  jobId: string,
) {
  return db
    .prepare(`SELECT m.*,i.status,i.error,t.message,r.message AS response,p.message AS previewCheck
    FROM coding_worker_messages m JOIN coding_job_inputs i ON i.id=m.inputId
    JOIN timeline t ON t.id=m.inputId AND t.agentId=m.agentId AND t.conversationId=m.jobId
    LEFT JOIN timeline r ON r.id=m.responseId AND r.agentId=m.agentId AND r.conversationId=m.jobId
    LEFT JOIN timeline p ON p.id='preview-check:' || m.inputId AND p.agentId=m.agentId AND p.conversationId=m.jobId
    WHERE m.agentId=? AND m.jobId=? ORDER BY i.createdAt,i.rowid`)
    .all(agentId, jobId)
    .map((row) => ({
      id: String(row.inputId),
      text: String(JSON.parse(String(row.message)).text),
      createdAt: Number(JSON.parse(String(row.message)).createdAt ?? 0),
      status:
        row.status === "abandoned"
          ? "acknowledged"
          : row.status === "failed"
            ? "failed"
            : row.completedAt
              ? row.response &&
                JSON.parse(String(row.response)).role === "assistant"
                ? "answered"
                : "response_unavailable"
              : row.respondingAt
                ? "responding"
                : row.deliveredAt
                  ? "delivered"
                  : "queued",
      error: String(row.error ?? ""),
      response: row.response
        ? String(JSON.parse(String(row.response)).text)
        : "",
      previewCheck: row.previewCheck
        ? String(JSON.parse(String(row.previewCheck)).text)
        : "",
      deliveredAt: row.deliveredAt ? Number(row.deliveredAt) : null,
    }));
}

export const sendWorkerMessage = (input: typeof WorkerMessageInput.Type) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const data = Schema.decodeUnknownSync(WorkerMessageInput)(input);
      const job = requireWorkspaceJob(db, data.agentId, data.id);
      requireConversation(db, data.agentId, data.id);
      const prior = db
        .prepare(
          `SELECT m.jobId,m.agentId,t.message FROM coding_worker_messages m JOIN timeline t ON t.id=m.inputId WHERE m.inputId=?`,
        )
        .get(data.requestId);
      if (prior) {
        if (
          prior.jobId !== data.id ||
          prior.agentId !== data.agentId ||
          JSON.parse(String(prior.message)).text !== data.text
        )
          throw new AgentStoreError({
            message:
              "This request ID was already used for a different worker message.",
          });
        return { id: data.requestId };
      }
      if (
        db
          .prepare(
            "SELECT id FROM timeline WHERE id=? UNION SELECT id FROM coding_job_inputs WHERE id=?",
          )
          .get(data.requestId, data.requestId)
      )
        throw new AgentStoreError({
          message: "This request ID is already in use.",
        });
      if (
        db
          .prepare(
            "SELECT i.id FROM coding_job_inputs i JOIN coding_worker_messages m ON m.inputId=i.id WHERE i.jobId=? AND i.status='failed'",
          )
          .get(job.id)
      )
        throw new AgentStoreError({
          message:
            "Inspect the failed submission in the existing worker, then acknowledge it before releasing the queue. Uncertain messages are never automatically replayed.",
        });
      if (
        db
          .prepare(
            "SELECT inputId FROM coding_worker_fences WHERE jobId=? AND acknowledgedAt IS NULL",
          )
          .get(job.id)
      )
        throw new AgentStoreError({
          message:
            "Inspect the uncertain coordinator/worker submission and acknowledge it before sending more messages.",
        });
      if (
        job.cancelRequested ||
        ["completed", "cancelled", "failed", "queued", "starting"].includes(
          job.status,
        )
      )
        throw new AgentStoreError({
          message:
            "This job has no available worker for continuation. Inspect its current state; completed or stopped jobs cannot be resumed here.",
        });
      if (
        !job.sessionIdentity ||
        !["working", "idle", "done"].includes(job.lastWorkerState)
      )
        throw new AgentStoreError({
          message:
            "Resolve the approval or restore and verify the existing worker in Herdr first. This composer cannot answer approval prompts or replace a missing worker.",
        });
      if (
        Number(
          db
            .prepare(
              "SELECT COUNT(*) n FROM coding_job_inputs WHERE jobId=? AND status IN ('queued','dispatching')",
            )
            .get(job.id)?.n,
        ) >= 20
      )
        throw new AgentStoreError({
          message:
            "This worker already has 20 queued messages. Wait for delivery before sending more.",
        });
      const workspace = readCodingWorkspace(db, data.agentId, data.id);
      const prompt = `${responseCaptureInstruction(data.requestId)}\nA user is speaking directly to this existing assignment worker. Reply to their message, preserving the same job, worktree, identity and authorization. This is explicit continuation if work was paused, but never approval for merge/deploy or an unresolved approval. Do not communicate through the managing agent or wait for its checkpoint.\nFor ANY preview status question, inspect the actual job-owned process/service AND make a fresh request to its endpoint. Report checked UTC time, process/service evidence, endpoint result, URL and revision if known, and concrete blocker. A stored URL or earlier availability is not proof. Status-only questions MUST NOT start, restart, refresh, or change anything. If you cannot inspect either process or endpoint, report unverified with the reason, never running. Explicit preview start/refresh may use existing task authorization and must report the updated revision after checking.\nLast reported preview (unverified context only): ${JSON.stringify({ url: workspace.previewUrl, revision: workspace.previewRevision })}\nUser message:\n${data.text}`;
      db.prepare(
        "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,status,createdAt) VALUES(?,?,?,?,'queued',?)",
      ).run(data.requestId, data.id, data.agentId, prompt, Date.now());
      db.prepare(
        "INSERT INTO coding_worker_messages(inputId,jobId,agentId,sessionIdentity,nativeSessionId,readOnly) VALUES(?,?,?,?,?,?)",
      ).run(
        data.requestId,
        data.id,
        data.agentId,
        job.sessionIdentity,
        job.nativeSessionId,
        isPreviewStatusQuestion(data.text) ? 1 : 0,
      );
      putMessage(
        db,
        data.agentId,
        {
          id: data.requestId,
          role: "user",
          text: data.text,
          createdAt: Date.now(),
        },
        data.id,
      );
      if (
        workspace.workflow !== "working" &&
        !isPreviewStatusQuestion(data.text)
      )
        writeCodingWorkspace(db, {
          ...workspace,
          workflow: "working",
          verification: "",
          integration: "pending",
        });
      // Do not change execution/observedWorking while a busy worker is still doing
      // its prior turn. The monitor owns that transition after actual delivery.
      return { id: data.requestId };
    }),
  );

export const acknowledgeWorkerFailure = (
  agentId: string,
  jobId: string,
  inputId: string,
) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const job = requireWorkspaceJob(db, agentId, jobId);
      requireConversation(db, agentId, jobId);
      if (
        job.cancelRequested ||
        !["review", "blocked", "running"].includes(job.status) ||
        !job.sessionIdentity ||
        !["idle", "done"].includes(job.lastWorkerState)
      )
        throw new AgentStoreError({
          message:
            "Wait for this same worker to be safely idle, with approvals resolved, before acknowledging inspection.",
        });
      const row = db
        .prepare(
          "SELECT m.sessionIdentity,m.nativeSessionId FROM coding_worker_messages m JOIN coding_job_inputs i ON i.id=m.inputId WHERE m.inputId=? AND m.jobId=? AND m.agentId=? AND i.status IN ('failed','abandoned') UNION SELECT sessionIdentity,nativeSessionId FROM coding_worker_fences WHERE inputId=? AND jobId=? AND agentId=?",
        )
        .get(inputId, jobId, agentId, inputId, jobId, agentId);
      if (
        !row ||
        row.sessionIdentity !== job.sessionIdentity ||
        row.nativeSessionId !== job.nativeSessionId
      )
        throw new AgentStoreError({
          message:
            "The failed message's worker identity must match the restored job.",
        });
      db.prepare(
        "UPDATE coding_worker_fences SET acknowledgedAt=? WHERE inputId=?",
      ).run(Date.now(), inputId);
      db.prepare(
        "UPDATE coding_job_inputs SET status='abandoned' WHERE id=?",
      ).run(inputId);
      putMessage(
        db,
        agentId,
        {
          id: `worker-inspected:${inputId}`,
          role: "notice",
          text: "The user confirmed inspecting this failed submission in the existing worker. It will not be replayed; remaining queued messages may now proceed.",
        },
        jobId,
      );
      return { id: inputId };
    }),
  );
