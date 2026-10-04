import type { Run } from "../runs/store.server";
import type { DynamicToolSpec } from "./protocol/v2/DynamicToolSpec";

// This ID is reserved for the internal Feed job, including already queued runs.
export const FEED_EDITOR_AUTOMATION_ID = "7e9b3bf2-640d-427c-9d6e-e31f5fb614ef";

const taskTools = [
  "roost_computer",
  "roost_request_approval",
  "roost_publish_artifact",
  "roost_payment_status",
  "roost_request_purchase",
  "roost_wait_for_purchase",
  "roost_cancel_purchase",
  "roost_fill_payment",
  "roost_record_purchase",
  "roost_read_feed",
  "roost_publish_feed_item",
  "roost_read_note",
  "roost_note_history",
  "roost_read_note_revision",
  "roost_read_conversations",
  "roost_list_agents",
  "roost_list_delegations",
  "roost_read_soul",
  "roost_list_models",
  "roost_list_automations",
  "roost_list_datasets",
  "roost_search_weather_locations",
  "roost_create_weather_tracker",
  "roost_save_dataset",
  "roost_delete_dataset",
  "roost_list_dashboards",
  "roost_save_dashboard",
  "roost_delete_dashboard",
  "roost_get_coding_configuration",
  "roost_list_coding_jobs",
  "roost_get_coding_job",
  "roost_get_coding_workspace",
  "roost_report_coding_workspace",
  "roost_continue_coding_job",
  "roost_complete_coding_job",
  "roost_stop_coding_job",
] as const;

function policy(tools: readonly string[], nativeTools: boolean) {
  return Object.freeze({ tools: Object.freeze([...tools]), nativeTools });
}

// New tools are denied until deliberately added to a run's policy.
const policies = Object.freeze({
  chat: policy(
    [
      ...taskTools,
      "roost_patch_note",
      "roost_restore_note",
      "roost_react_to_message",
      "roost_notify",
      "roost_show_dashboard",
      "roost_delegate_task",
      "roost_update_soul",
      "roost_save_automation",
      "roost_set_automation_enabled",
      "roost_run_automation",
      "roost_delete_automation",
      "roost_save_coding_configuration",
      "roost_save_execution_profile",
      "roost_start_coding_job",
    ],
    true,
  ),
  automation: policy([...taskTools, "roost_notify"], true),
  delegation: policy(taskTools, true),
  coding: policy(taskTools, true),
  handoff: policy([], false),
  reflection: policy(["roost_read_soul", "roost_update_soul"], false),
  feed: policy(["roost_read_feed", "roost_publish_feed_item"], false),
});
export type RunCapabilities = (typeof policies)[keyof typeof policies];

export function runCapabilities(
  kind: Run["kind"],
  automationId?: string | null,
): RunCapabilities {
  if (kind === "automation" && automationId === FEED_EDITOR_AUTOMATION_ID)
    return policies.feed;
  return policies[kind] ?? policies.handoff;
}

export function allowsTool(capabilities: RunCapabilities, tool: string) {
  return capabilities.tools.includes(tool);
}

export function filterRunTools(
  capabilities: RunCapabilities,
  tools: readonly DynamicToolSpec[],
) {
  return tools.filter((tool) => allowsTool(capabilities, tool.name));
}

export function deniedToolResponse() {
  return {
    success: false,
    contentItems: [
      {
        type: "inputText" as const,
        text: "This run cannot use that tool. Follow-up actions require a fresh user chat or a separately authorized run.",
      },
    ],
  };
}
