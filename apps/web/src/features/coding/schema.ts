import { Schema } from "effect";

const Label = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(160));
const Text = Schema.String.pipe(Schema.maxLength(32000));
const Location = Schema.String.pipe(Schema.maxLength(4000));
const Revision = Schema.Int.pipe(Schema.greaterThanOrEqualTo(0));

export const TaskSource = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160)),
  name: Label,
  databaseUrl: Location,
  filter: Text,
  instructions: Text,
});
export type TaskSource = typeof TaskSource.Type;

export const CodingSettings = Schema.Struct({
  agentId: Schema.UUID,
  repository: Location,
  projectInstructions: Text,
  defaultProfileId: Schema.NullOr(Schema.UUID),
  sources: Schema.Array(TaskSource).pipe(Schema.maxItems(50)),
  revision: Revision,
});
export type CodingSettings = typeof CodingSettings.Type;

export const ExecutionProfile = Schema.Struct({
  id: Schema.UUID,
  name: Label,
  kind: Schema.Literal("local", "ssh"),
  target: Location,
  instructions: Text,
  revision: Revision,
});
export type ExecutionProfile = typeof ExecutionProfile.Type;

export const CodingJobStatus = Schema.Literal(
  "queued",
  "starting",
  "running",
  "blocked",
  "review",
  "completed",
  "failed",
  "cancelled",
);
export type CodingJobStatus = typeof CodingJobStatus.Type;

const LaunchFields = {
  id: Schema.UUID,
  agentId: Schema.UUID,
  title: Label,
  assignment: Schema.String.pipe(Schema.maxLength(100000)),
  brief: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(100000)),
  profileId: Schema.NullOr(Schema.UUID),
  sourceUrl: Location,
  sourceRunId: Schema.String.pipe(Schema.maxLength(200)),
  cwd: Location,
  sessionName: Location,
  workerName: Location,
  workerKind: Location,
  remoteTarget: Location,
  repository: Location,
  projectInstructions: Text,
  profileInstructions: Text,
};

const RuntimeFields = {
  status: CodingJobStatus,
  summary: Schema.String.pipe(Schema.maxLength(100000)),
  output: Schema.String.pipe(Schema.maxLength(100000)),
  error: Text,
  lastWorkerState: Location,
  observedWorking: Schema.Boolean,
  dispatchedAt: Schema.NullOr(Schema.Number),
  notifiedStatus: Location,
  paneId: Location,
  sessionIdentity: Location,
  nativeSessionId: Location,
  launchOwner: Location,
  cancelRequested: Schema.Boolean,
  lastCheckedAt: Schema.Number,
};

export const CodingJob = Schema.Struct({
  ...LaunchFields,
  ...RuntimeFields,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  revision: Revision,
});
export type CodingJob = typeof CodingJob.Type;

export const CreateCodingJob = Schema.Struct({
  id: LaunchFields.id,
  agentId: LaunchFields.agentId,
  title: LaunchFields.title,
  assignment: Schema.optional(LaunchFields.assignment),
  brief: LaunchFields.brief,
  profileId: Schema.optional(LaunchFields.profileId),
  sourceUrl: Schema.optional(LaunchFields.sourceUrl),
  sourceRunId: Schema.optional(LaunchFields.sourceRunId),
  cwd: LaunchFields.cwd,
  sessionName: LaunchFields.sessionName,
  workerName: LaunchFields.workerName,
  workerKind: LaunchFields.workerKind,
  remoteTarget: Schema.optional(LaunchFields.remoteTarget),
  repository: Schema.optional(LaunchFields.repository),
  projectInstructions: Schema.optional(LaunchFields.projectInstructions),
  profileInstructions: Schema.optional(LaunchFields.profileInstructions),
});
export type CreateCodingJob = typeof CreateCodingJob.Type;

export const CodingJobPatch = Schema.partial(Schema.Struct(RuntimeFields));
export type CodingJobPatch = typeof CodingJobPatch.Type;
