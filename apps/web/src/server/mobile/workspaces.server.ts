import { Effect, Schema } from "effect";
import {
  ContinueJobFeedback,
  JobFeedbackInput,
  WorkerMessageInput,
} from "../../features/coding/workspace-schema";
import {
  decodeCreateDashboardTracker,
  decodeDashboardAction,
} from "../../features/dashboards/actions";
import { chartDataError } from "../../features/dashboards/chart-data";
import { decodeShowDashboard } from "../../features/dashboards/chat";
import { changeDashboardPresentationSchema } from "../../features/dashboards/presentation";
import type {
  DashboardDataset,
  DashboardWidget,
} from "../../features/dashboards/schema";
import {
  NoteInstructionWrite,
  NoteRestore,
  NoteWrite,
} from "../../features/notes/schema";
import { withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import {
  acknowledgeWorkerFailure,
  sendWorkerMessage,
} from "../coding/conversation.server";
import { stopCodingJob } from "../coding/jobs.server";
import { getCodingJob, listCodingJobs } from "../coding/store.server";
import { continueJobFeedback } from "../coding/workspace.server";
import {
  getJobWorkspace,
  readCodingWorkspace,
  saveJobFeedback,
} from "../coding/workspace-store.server";
import {
  createDashboardTracker,
  updateDashboardContent,
} from "../dashboards/actions.server";
import { readChatDashboard } from "../dashboards/chat.server";
import {
  readDashboard,
  updateDashboardPresentation,
} from "../dashboards/presentation.server";
import { setDashboardPreference } from "../dashboards/store.server";
import { assertAvailable } from "../maintenance.server";
import {
  noteHistory,
  readNote,
  readNoteRevision,
  restoreNote,
  saveNote,
  saveNoteInstructions,
} from "../notes/store.server";

export class MobileWorkspaceError extends Error {
  status: number;
  constructor(message: string) {
    super(message.replace(/^(?:PRESENTATION|DASHBOARD)_CONFLICT:\s*/, ""));
    this.status =
      message.startsWith("NOTE_CONFLICT:") ||
      message.startsWith("PRESENTATION_CONFLICT:") ||
      message.startsWith("DASHBOARD_CONFLICT:")
        ? 409
        : 400;
  }
}

async function run<A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  const result = await Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );
  if (!result.ok) throw new MobileWorkspaceError(result.error);
  return result.value;
}

function mobileDashboard<
  T extends {
    widgets: readonly DashboardWidget[];
    datasets: readonly DashboardDataset[];
  },
>(snapshot: T) {
  return {
    ...snapshot,
    widgets: snapshot.widgets.map((widget) => ({
      ...widget,
      blocks: widget.blocks.map((block) =>
        block.type === "dataset-chart"
          ? {
              ...block,
              chartError: chartDataError(
                block,
                snapshot.datasets.find((item) => item.key === block.datasetKey),
              ),
            }
          : block,
      ),
    })),
  };
}

// Called only after mobile bearer authentication. Every resource is resolved
// against the agent in the path; a body cannot change its owner.
export async function mobileWorkspaceRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
): Promise<{ value: unknown; status?: number } | null> {
  const match =
    /^agents\/([^/]+)\/(dashboard|jobs|note)(?:\/([^/]+)(?:\/(feedback|continue|stop|messages|acknowledge))?)?$/.exec(
      path,
    );
  if (!match) return null;
  const agentId = Schema.decodeUnknownSync(Schema.UUID)(match[1]);
  const [, , section, rawId, action] = match;
  // Stop remains available during maintenance, as on the web.
  if (action !== "stop")
    await run(
      withAgentStore((db) => {
        assertAvailable(db);
        requireAgent(db, agentId);
      }),
    );
  if (section === "note") {
    if (request.method === "GET") {
      if (!rawId) return { value: await run(readNote(agentId)) };
      if (rawId === "history") {
        const before = new URL(request.url).searchParams.get("before");
        return {
          value: await run(
            noteHistory(
              agentId,
              before === null
                ? undefined
                : Schema.decodeUnknownSync(
                    Schema.NumberFromString.pipe(
                      Schema.int(),
                      Schema.nonNegative(),
                    ),
                  )(before),
            ),
          ),
        };
      }
      const revision = Schema.decodeUnknownSync(
        Schema.NumberFromString.pipe(Schema.int(), Schema.nonNegative()),
      )(rawId);
      return { value: await run(readNoteRevision(agentId, revision)) };
    }
    if (request.method === "POST") {
      const data = await body(request);
      if (!rawId)
        return {
          value: await run(
            saveNote(agentId, Schema.decodeUnknownSync(NoteWrite)(data)),
          ),
        };
      if (rawId === "instructions")
        return {
          value: await run(
            saveNoteInstructions(
              agentId,
              Schema.decodeUnknownSync(NoteInstructionWrite)(data),
            ),
          ),
        };
      if (rawId === "restore")
        return {
          value: await run(
            restoreNote(agentId, Schema.decodeUnknownSync(NoteRestore)(data)),
          ),
        };
    }
  }
  if (
    section === "dashboard" &&
    rawId === "chat" &&
    !action &&
    request.method === "GET"
  ) {
    const query = new URL(request.url).searchParams;
    if (query.getAll("key").length !== 1)
      throw new MobileWorkspaceError("Provide one saved dashboard key.");
    const input = decodeShowDashboard(Object.fromEntries(query));
    return {
      value: mobileDashboard(await run(readChatDashboard(agentId, input.key))),
    };
  }
  if (
    section === "dashboard" &&
    rawId === "tracker" &&
    !action &&
    request.method === "POST"
  ) {
    return {
      value: await run(
        createDashboardTracker(
          agentId,
          decodeCreateDashboardTracker(await body(request)),
        ),
      ),
    };
  }
  if (
    section === "dashboard" &&
    rawId === "action" &&
    !action &&
    request.method === "POST"
  ) {
    return {
      value: await run(
        updateDashboardContent(
          agentId,
          decodeDashboardAction(await body(request)),
        ),
      ),
    };
  }
  if (
    section === "dashboard" &&
    rawId === "presentation" &&
    !action &&
    request.method === "POST"
  ) {
    const input = changeDashboardPresentationSchema.parse(await body(request));
    return { value: await run(updateDashboardPresentation(agentId, input)) };
  }
  if (section === "dashboard" && !rawId) {
    if (request.method === "POST") {
      const data = Schema.decodeUnknownSync(
        Schema.Struct({ enabled: Schema.Boolean }),
      )(await body(request));
      return { value: await run(setDashboardPreference(data.enabled)) };
    }
    if (request.method === "GET") {
      return {
        value: mobileDashboard(await run(readDashboard(agentId))),
      };
    }
  }
  if (section === "jobs") {
    if (!rawId && request.method === "GET") {
      const jobs = await run(listCodingJobs(agentId));
      return {
        value: await run(
          withAgentStore((db) =>
            jobs.map((job) => ({
              ...job,
              workspace: readCodingWorkspace(db, agentId, job.id),
            })),
          ),
        ),
      };
    }
    if (rawId) {
      const id = Schema.decodeUnknownSync(Schema.UUID)(rawId);
      if (!action && request.method === "GET") {
        const job = await run(getCodingJob(agentId, id));
        return { value: { job, ...(await run(getJobWorkspace(agentId, id))) } };
      }
      if (request.method === "POST") {
        if (action === "stop")
          return { value: await run(stopCodingJob(agentId, id)) };
        const data = await body(request);
        const owned = { ...(data as Record<string, unknown>), agentId, id };
        if (action === "messages")
          return {
            value: await run(
              sendWorkerMessage(
                Schema.decodeUnknownSync(WorkerMessageInput)(owned),
              ),
            ),
          };
        if (action === "acknowledge") {
          const input = Schema.decodeUnknownSync(
            Schema.Struct({ inputId: Schema.UUID }),
          )(data);
          return {
            value: await run(
              acknowledgeWorkerFailure(agentId, id, input.inputId),
            ),
          };
        }
        if (action === "feedback")
          return {
            value: await run(
              saveJobFeedback(
                Schema.decodeUnknownSync(JobFeedbackInput)(owned),
              ),
            ),
          };
        if (action === "continue")
          return {
            value: await run(
              continueJobFeedback(
                Schema.decodeUnknownSync(ContinueJobFeedback)(owned),
              ),
            ),
          };
      }
    }
  }
  return {
    value: { error: "Method or workspace route not supported." },
    status: 405,
  };
}
