import { Schema } from "effect";
import {
  ContinueJobFeedback,
  PREVIEW_REPORT_TTL_MS,
  UpdateCodingWorkspace,
} from "../../features/coding/workspace-schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import { requireConversation } from "../runs/threads.server";
import { putMessage } from "../runs/timeline.server";
import { writeTransaction } from "../transaction.server";
import { queueCodingContinuation, requireCodingRun } from "./jobs.server";
import {
  assertFeedbackMayResume,
  readCodingWorkspace,
  readJobFeedback,
  requireWorkspaceJob,
  writeCodingWorkspace,
} from "./workspace-store.server";

export const reportCodingWorkspace = (
  agentId: string,
  runId: string | undefined,
  input: typeof UpdateCodingWorkspace.Type,
) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const data = Schema.decodeUnknownSync(UpdateCodingWorkspace)(input);
      requireCodingRun(db, agentId, runId, "continue", data.id);
      const job = requireWorkspaceJob(db, agentId, data.id);
      requireConversation(db, agentId, job.id);
      const current = readCodingWorkspace(db, agentId, job.id);
      if (current.revision !== data.revision)
        throw new AgentStoreError({
          message: "This workspace changed. Read it again before updating.",
        });
      if (data.workflow !== "feedback")
        assertFeedbackMayResume(db, agentId, job.id, runId!);
      if (
        data.workflow !== "working" &&
        data.workflow !== current.workflow &&
        (job.status !== "review" || job.cancelRequested)
      )
        throw new AgentStoreError({
          message:
            "Wait for the existing worker to be ready before publishing feedback or review readiness.",
        });
      if (
        data.workflow === "review" &&
        (!data.verification.trim() || !data.pullRequests.length)
      )
        throw new AgentStoreError({
          message:
            "Review readiness requires verification evidence and a PR URL.",
        });
      if (
        data.previewAvailability === "running" &&
        (!data.previewUrl || !data.previewRevision.trim())
      )
        throw new AgentStoreError({
          message: "A running preview needs its URL and current revision.",
        });
      if (
        data.workflow !== "working" &&
        db
          .prepare(
            "SELECT id FROM coding_job_inputs WHERE jobId=? AND status IN ('queued','dispatching','launch_queued','launching')",
          )
          .get(job.id)
      )
        throw new AgentStoreError({
          message:
            "A follow-up is still pending. Wait before pausing for feedback.",
        });
      const now = Date.now();
      const next = writeCodingWorkspace(db, {
        ...current,
        ...data,
        previewReportedAt: now,
        previewExpiresAt:
          data.previewAvailability === "running"
            ? now + PREVIEW_REPORT_TTL_MS
            : 0,
      });
      if (
        current.latestChanges !== next.latestChanges ||
        current.workflow !== next.workflow
      )
        putMessage(
          db,
          agentId,
          {
            id: `workspace:${job.id}:${next.revision}`,
            role: "notice",
            title:
              next.workflow === "feedback"
                ? "Ready for feedback"
                : next.workflow === "review"
                  ? "Ready for review"
                  : "Job update",
            text: next.latestChanges || "Workspace updated.",
          },
          next.conversationId,
        );
      return next;
    }),
  );

export const continueJobFeedback = (input: typeof ContinueJobFeedback.Type) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const data = Schema.decodeUnknownSync(ContinueJobFeedback)(input);
      const job = requireWorkspaceJob(db, data.agentId, data.id);
      requireConversation(db, data.agentId, data.id);
      if (new Set(data.messageIds).size !== data.messageIds.length)
        throw new AgentStoreError({
          message: "Choose each feedback message only once.",
        });
      const messages = readJobFeedback(db, data.agentId, data.id).filter(
        (item) => data.messageIds.includes(item.id),
      );
      if (messages.length !== data.messageIds.length)
        throw new AgentStoreError({
          message: "Feedback not found in this job.",
        });
      const prompt = `Continue only this existing assignment using the user-selected feedback below. Preserve the original authorization, worktree and worker identity. Do not replay the original prompt or start another job. Feedback does not authorize merge, deploy, release or unrelated work.\n${messages.map((item) => `Feedback on preview ${item.previewRevision || "unspecified"}:\n${item.text}`).join("\n\n")}`;
      if (prompt.length > 32000)
        throw new AgentStoreError({
          message: "Select less feedback for this continuation.",
        });
      const prior = db
        .prepare("SELECT * FROM coding_job_inputs WHERE id=?")
        .get(data.requestId);
      if (prior) {
        const linked = readJobFeedback(db, data.agentId, data.id).filter(
          (item) => item.inputId === data.requestId,
        );
        if (
          prior.jobId !== data.id ||
          prior.agentId !== data.agentId ||
          prior.prompt !== prompt ||
          linked.length !== messages.length ||
          linked.some((item) => !data.messageIds.includes(item.id))
        )
          throw new AgentStoreError({
            message:
              "This continuation ID was already used for different feedback.",
          });
        return { id: data.requestId, status: String(prior.status) };
      }
      if (job.revision !== data.revision)
        throw new AgentStoreError({
          message:
            "This job changed. Refresh and review its current state before continuing.",
        });
      if (messages.some((item) => item.inputId))
        throw new AgentStoreError({
          message:
            "This feedback was already submitted. Inspect its delivery status; it will not be replayed.",
        });
      // UI continuation never retries a launch or answers a terminal approval.
      if (
        !job.sessionIdentity ||
        !["idle", "done"].includes(job.lastWorkerState)
      )
        throw new AgentStoreError({
          message:
            "The existing worker must be ready and its identity confirmed. Resolve terminal blockers first.",
        });
      const result = queueCodingContinuation(db, data.agentId, {
        id: data.id,
        requestId: data.requestId,
        prompt,
      });
      for (const item of messages)
        db.prepare(
          "UPDATE coding_job_feedback SET inputId=? WHERE messageId=? AND jobId=?",
        ).run(data.requestId, item.id, data.id);
      putMessage(
        db,
        data.agentId,
        {
          id: `continuation:${data.requestId}`,
          role: "notice",
          title: "Feedback submitted",
          text: "Selected feedback was queued for the existing assignment worker. Delivery status is shown with each feedback message.",
        },
        data.id,
      );
      return result;
    }),
  );
