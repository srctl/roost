import { Effect, JSONSchema, Schema } from "effect";
import { AutomationInput } from "../../features/automations/schema";
import { patchSoul, readSoul, SoulPatch } from "../agents/soul.server";
import { listAgents } from "../agents/store.server";
import { approvalTools } from "../approvals/tools.server";
import {
  deleteAutomation,
  listAutomations,
  saveAutomation,
  toggleAutomation,
} from "../automations/store.server";
import { codingTools, handleCodingTool } from "../coding/tools.server";
import {
  DeleteDashboard,
  dashboardTools,
  deleteDashboard,
  deleteDataset,
  listDashboards,
  listDatasets,
  SaveDashboard,
  SaveDataset,
  saveDashboard,
  saveDataset,
} from "../dashboards/tools.server";
import {
  DelegateTask,
  delegateTask,
  listDelegations,
} from "../delegations/store.server";
import { fileTools } from "../files/tools.server";
import {
  NotifyAgent,
  notificationTools,
  notifyAgent,
} from "../notifications/tools.server";
import { reflectionTools } from "../reflections/store.server";
import { runAutomationNow } from "../runs/store.server";
import { CodexError, getCodexConnection } from "./app-server.server";
import type { JsonValue } from "./protocol/serde_json/JsonValue";
import type { DynamicToolCallResponse } from "./protocol/v2/DynamicToolCallResponse";
import type { DynamicToolSpec } from "./protocol/v2/DynamicToolSpec";

const SaveAutomationTool = Schema.Struct({
  ...AutomationInput.omit("agentId").fields,
  expectedRevision: Schema.optional(Schema.Number),
});

const ToggleAutomationTool = Schema.Struct({
  id: Schema.UUID,
  revision: Schema.Number,
  enabled: Schema.Boolean,
});

const RunAutomationTool = Schema.Struct({
  id: Schema.UUID,
  requestId: Schema.UUID,
});

const DeleteAutomationTool = Schema.Struct({
  id: Schema.UUID,
  revision: Schema.NonNegativeInt,
});

export const agentTools: DynamicToolSpec[] = [
  ...approvalTools,
  ...fileTools,
  ...dashboardTools,
  ...notificationTools,
  {
    type: "function",
    name: "roost_list_agents",
    description:
      "List the other agents and their stated responsibilities. Use this to find a specialist before delegating. Each agent has separate soul, memory, and conversation history.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_delegate_task",
    description:
      "Assign a concrete part of the user's request to an existing specialist agent asynchronously. Supply a stable requestId UUID, target agentId from roost_list_agents, and a self-contained task including relevant context and the user's authorization limits. Do not pass whole conversations or private memory stores. Returns immediately: finish your handoff reply and remain available, do not wait or poll. A result or failure automatically wakes you in a later turn. Only user chat turns can delegate; delegated jobs, result updates, and automations cannot delegate further. Never delegate to yourself or duplicate outstanding work. All agents share the same desktop and must wait for its owner to finish.",
    inputSchema: JSONSchema.make(DelegateTask) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_list_delegations",
    description:
      "Inspect tasks you assigned or received, for a user-requested status check. Results are delivered automatically; do not poll this tool while waiting.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_read_soul",
    description:
      "Read your own persistent SOUL.md and its current revision before editing it.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_update_soul",
    description:
      "Apply exact targeted edits to your soul during an authorized reflection, or after the user explicitly requests a lasting change or agrees to your proposed change. Read the soul first, preserve unrelated text, and supply a short reason. Do not store schedules or personal facts here.",
    inputSchema: JSONSchema.make(SoulPatch) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_list_models",
    description:
      "List currently available model identifiers and display names for automation model selection. Use exact identifiers from this catalog; do not guess model names.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_list_automations",
    description:
      "Read the current time and server timezone, and list your saved automations, IDs, schedules, enablement, and revisions. Call this before scheduling relative times.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_save_automation",
    description:
      "Create or edit an automation for this agent when explicitly requested by the user. Use a stable UUID for a creation; for an edit use the existing id and expectedRevision from the list tool. Prefer ONE cron automation for multiple daily times: kind=cron, expression='0 8-22/2 * * *' means every two hours from 08:00 through 22:00 daily. Cron uses five fields: minute hour day-of-month month day-of-week. Timezone must be an IANA name. Recurring schedules accept optional startsOn and endsOn as inclusive YYYY-MM-DD calendar dates in that timezone. Do not invent an end date for a condition such as until delivered. Weekly days are 0=Sunday through 6=Saturday. One-time timestamps need an explicit offset. Ask if the task or intended time is unclear. Use an exact model identifier from roost_list_models to override the agent model for this automation. Omit model to keep the existing selection on edits (or inherit the agent model on creation); set model=null to restore the agent default. Schedules do not expand your permissions.",
    inputSchema: JSONSchema.make(SaveAutomationTool) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_set_automation_enabled",
    description:
      "Pause or resume an existing automation at the user's request. Read its current revision first. Pausing cancels queued runs; an active run continues until explicitly stopped.",
    inputSchema: JSONSchema.make(ToggleAutomationTool) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_delete_automation",
    description:
      "Delete one of this agent's automations only when explicitly requested by the user. Read its current ID and revision from the list tool first. Deletion removes the schedule, cancels queued runs, and requests cancellation of active runs. Past run history is retained. This cannot be undone; use pause for a temporary stop.",
    inputSchema: JSONSchema.make(DeleteAutomationTool) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_run_automation",
    description:
      "Queue one immediate run of a saved automation at the user's request. Use a stable requestId UUID so retries don't create duplicate runs.",
    inputSchema: JSONSchema.make(RunAutomationTool) as unknown as JsonValue,
  },
];

type AgentToolContext = {
  agentId: string;
  runId?: string;
  allowMutations: boolean | "reflection";
};

export function handleAgentTool(
  { agentId, runId, allowMutations }: AgentToolContext,
  tool: string,
  arguments_: unknown,
) {
  const action = Effect.gen(function* () {
    if (allowMutations === "reflection" && !reflectionTools.has(tool))
      return yield* new CodexError({
        message: "Reflection can only read and update its own soul.",
      });
    if (codingTools.some((spec) => spec.name === tool))
      return yield* handleCodingTool(agentId, runId, tool, arguments_);
    if (tool === "roost_notify")
      return yield* notifyAgent(
        agentId,
        runId,
        yield* Schema.decodeUnknown(NotifyAgent)(arguments_),
      );
    if (tool === "roost_list_datasets") return yield* listDatasets(agentId);
    if (tool === "roost_save_dataset")
      return yield* saveDataset(
        agentId,
        yield* Schema.decodeUnknown(SaveDataset)(arguments_),
      );
    if (tool === "roost_delete_dataset")
      return yield* deleteDataset(
        agentId,
        yield* Schema.decodeUnknown(DeleteDashboard)(arguments_),
      );
    if (tool === "roost_list_dashboards") return yield* listDashboards(agentId);
    if (tool === "roost_save_dashboard")
      return yield* saveDashboard(
        agentId,
        yield* Schema.decodeUnknown(SaveDashboard)(arguments_),
      );
    if (tool === "roost_delete_dashboard")
      return yield* deleteDashboard(
        agentId,
        yield* Schema.decodeUnknown(DeleteDashboard)(arguments_),
      );
    if (tool === "roost_list_agents") {
      return (yield* listAgents())
        .filter((agent) => agent.id !== agentId)
        .map(({ id, name, instructions }) => ({
          id,
          name,
          responsibility: instructions,
        }));
    }

    if (tool === "roost_list_delegations") {
      return yield* listDelegations(agentId);
    }

    if (tool === "roost_delegate_task") {
      if (!runId) {
        return yield* new CodexError({
          message: "There is no active run to delegate from.",
        });
      }

      return yield* delegateTask(
        agentId,
        runId,
        yield* Schema.decodeUnknown(DelegateTask)(arguments_),
      );
    }

    if (tool === "roost_read_soul") {
      return yield* readSoul(agentId);
    }

    if (tool === "roost_list_models") return yield* getCodexConnection;

    if (tool === "roost_list_automations") {
      return {
        automations: yield* listAutomations(agentId),
        currentTime: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }

    if (!allowMutations) {
      return yield* new CodexError({
        message: "Background runs cannot change souls or automations.",
      });
    }

    if (tool === "roost_update_soul") {
      return yield* patchSoul(
        agentId,
        yield* Schema.decodeUnknown(SoulPatch)(arguments_),
        allowMutations === "reflection" ? "reflection" : "agent",
      );
    }

    if (tool === "roost_save_automation") {
      const args = yield* Schema.decodeUnknown(SaveAutomationTool)(arguments_);

      return yield* saveAutomation({ ...args, agentId }, args.expectedRevision);
    }

    if (tool === "roost_set_automation_enabled") {
      const args =
        yield* Schema.decodeUnknown(ToggleAutomationTool)(arguments_);
      yield* toggleAutomation(agentId, args.id, args.revision, args.enabled);

      return { updated: true };
    }

    if (tool === "roost_run_automation") {
      const args = yield* Schema.decodeUnknown(RunAutomationTool)(arguments_);

      return yield* runAutomationNow(agentId, args.id, args.requestId);
    }

    if (tool === "roost_delete_automation") {
      const args =
        yield* Schema.decodeUnknown(DeleteAutomationTool)(arguments_);
      yield* deleteAutomation(agentId, args.id, args.revision);

      return { deleted: true };
    }

    return yield* new CodexError({ message: "Unknown Roost tool." });
  });

  return Effect.runPromise(
    action.pipe(
      Effect.match({
        onSuccess: (value): DynamicToolCallResponse => ({
          success: true,
          contentItems: [{ type: "inputText", text: JSON.stringify(value) }],
        }),
        onFailure: (error): DynamicToolCallResponse => ({
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: "message" in error ? error.message : "Invalid soul update.",
            },
          ],
        }),
      }),
    ),
  );
}
