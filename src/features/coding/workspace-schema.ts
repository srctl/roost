import { Schema } from "effect";
import type { CodingJob } from "./schema";

const Text = Schema.String.pipe(Schema.maxLength(32000));
export const WebUrl = Schema.String.pipe(
  Schema.maxLength(4000),
  Schema.filter(
    (value) => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return (
          ["https:", "http:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    },
    { message: () => "Use an HTTP(S) URL without embedded credentials." },
  ),
);
export const WorkspaceFields = {
  workflow: Schema.Literal("working", "feedback", "review"),
  previewUrl: WebUrl,
  previewRevision: Schema.String.pipe(Schema.maxLength(160)),
  previewAvailability: Schema.Literal("running", "unavailable", "not_needed"),
  latestChanges: Text,
  verification: Text,
  integration: Schema.Literal("pending", "verified"),
  pullRequests: Schema.Array(WebUrl.pipe(Schema.minLength(1))).pipe(
    Schema.maxItems(10),
  ),
};
export const CodingWorkspace = Schema.Struct({
  ...WorkspaceFields,
  jobId: Schema.UUID,
  agentId: Schema.UUID,
  conversationId: Schema.UUID,
  revision: Schema.NonNegativeInt,
  updatedAt: Schema.Number,
});
export type CodingWorkspace = typeof CodingWorkspace.Type;
export const UpdateCodingWorkspace = Schema.Struct({
  ...WorkspaceFields,
  id: Schema.UUID,
  revision: Schema.NonNegativeInt,
});
export const JobFeedbackInput = Schema.Struct({
  agentId: Schema.UUID,
  id: Schema.UUID,
  requestId: Schema.UUID,
  text: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(16000)),
  previewRevision: Schema.String.pipe(Schema.maxLength(160)),
});
export const ContinueJobFeedback = Schema.Struct({
  agentId: Schema.UUID,
  id: Schema.UUID,
  requestId: Schema.UUID,
  messageIds: Schema.Array(Schema.UUID).pipe(
    Schema.minItems(1),
    Schema.maxItems(50),
  ),
  revision: Schema.NonNegativeInt,
});
export type JobFeedback = {
  id: string;
  text: string;
  createdAt: number;
  previewRevision: string;
  inputId: string | null;
  delivery: string | null;
  error: string;
};
export function jobWorkflowLabel(job: CodingJob, workspace: CodingWorkspace) {
  if (
    job.cancelRequested &&
    !["completed", "failed", "cancelled"].includes(job.status)
  )
    return "Stopping…";
  if (job.status === "completed") return "Completed";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "failed") return "Failed";
  if (job.status === "blocked") return "Blocked";
  if (job.status === "review" && workspace.workflow === "feedback")
    return "Ready for feedback";
  if (job.status === "review" && workspace.workflow === "review")
    return "Ready for review";
  return "Working";
}
