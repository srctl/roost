import { JSONSchema } from "effect";
import {
  DeleteDashboard,
  SaveDashboard,
} from "../../features/dashboards/schema";
import type { JsonValue } from "../codex/protocol/serde_json/JsonValue";
import type { DynamicToolSpec } from "../codex/protocol/v2/DynamicToolSpec";

export {
  DeleteDashboard,
  SaveDashboard,
} from "../../features/dashboards/schema";
export { deleteDashboard, listDashboards, saveDashboard } from "./store.server";

export const dashboardTools: DynamicToolSpec[] = [
  {
    type: "function",
    name: "roost_list_dashboards",
    description:
      "Read your persistent dashboard widgets and current revisions. Widgets live on the Dashboard page outside the conversation. Dashboards must first be enabled by the user in Settings; you cannot enable them. Use stable keys to update existing trackers rather than making duplicates. You can only access your own agent's widgets.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_save_dashboard",
    description:
      "Create or update a named dashboard widget from the user's tracking requirements. Discuss the useful content with the user: general trackers, project/task status, or metrics/trends. Compose bounded native blocks: markdown notes, metrics (label/value/note), tables (columns/rows), line or bar charts (title/style/points with label/value), links (http/https sources), tasks (label/status todo|doing|done). No executable HTML. Use a stable lowercase key such as project-status. Omit expectedRevision only for a new key; read first and pass the current revision to update. Save complete desired content. Updates persist outside conversation without creating chat messages; existing user-authorized automations can refresh them. Never invent fresh measurements or imply data was checked when it was not. Dashboards must already be enabled in Settings.",
    inputSchema: JSONSchema.make(SaveDashboard) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_delete_dashboard",
    description:
      "Remove one of your dashboard widgets when the user asks. Read its current revision first and supply expectedRevision. This removes its saved content, not any external source data.",
    inputSchema: JSONSchema.make(DeleteDashboard) as unknown as JsonValue,
  },
];
