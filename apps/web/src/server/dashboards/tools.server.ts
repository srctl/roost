import { JSONSchema } from "effect";
import { ShowDashboard } from "../../features/dashboards/chat";
import {
  DeleteDashboard,
  SaveDashboard,
  SaveDataset,
} from "../../features/dashboards/schema";
import type { JsonValue } from "../codex/protocol/serde_json/JsonValue";
import type { DynamicToolSpec } from "../codex/protocol/v2/DynamicToolSpec";

export {
  DeleteDashboard,
  SaveDashboard,
  SaveDataset,
} from "../../features/dashboards/schema";
export { showDashboard } from "./chat.server";
export {
  deleteDashboard,
  deleteDataset,
  listDashboards,
  listDatasets,
  saveDashboard,
  saveDataset,
} from "./store.server";

export const dashboardTools: DynamicToolSpec[] = [
  {
    type: "function",
    name: "roost_list_datasets",
    description:
      "Read all your saved dashboard data sources, typed columns, rows, source metadata, and revisions. Agent-scoped, bounded snapshots, not live connectors. Dashboards must be enabled by the user.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "roost_save_dataset",
    description:
      "Create or replace your saved dashboard data source using a stable key. Read first; pass expectedRevision for updates, omit for new keys. Up to 30 datasets, 8 uniquely keyed typed columns (string/number/boolean), 200 rectangular rows, 64 KB each. Null cells are allowed in tables but not chart columns. Record description/sourceUrl when known; never invent observations. Changes that break existing chart references are rejected: update widgets first. Saving is not a live connection or permission to access external services.",
    inputSchema: JSONSchema.make(SaveDataset) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_delete_dataset",
    description:
      "Remove your saved data source only when requested by the user. Read its revision first. Remove chart references first; sources still in use cannot be deleted.",
    inputSchema: JSONSchema.make(DeleteDashboard) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_list_dashboards",
    description:
      "Read your persistent dashboard widgets and current revisions. Widgets live on your agent’s Dashboard page, accessible by opening the agent and choosing Dashboard. Dashboards must first be enabled by the user in Settings; you cannot enable them. Use stable keys to update existing trackers rather than making duplicates. You can only access your own agent's widgets.",
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
      "Create or update a named dashboard widget from the user's tracking requirements. Discuss the useful content with the user: general trackers, project/task status, or metrics/trends. Compose bounded native blocks: markdown notes, metrics (label/value/note), tables (columns/rows), line or bar charts (title/style/points with label/value), links (http/https sources), tasks (label/status todo|doing|done). For interactive trackers use todo-list {type,id:stable-block-key,items:[{id:UUID,label,done:boolean}]} or calorie-log {type,id:stable-block-key,entries:[{id:UUID,date:YYYY-MM-DD,label,calories:integer}]}. Empty interactive blocks are allowed so the user can add items. Todo lists hold up to 100 items; calorie logs hold up to 200 entries with calories from 0 to 20000. Labels are 1-200 characters. Dates must be valid calendar dates. Keep block IDs and item UUIDs stable; block IDs and item IDs must be unique within a widget. Interactive controls write directly to this saved widget; read the latest revision before agent edits and preserve entries the user added. Record only user-supplied calorie amounts; do not estimate, invent goals or add nutrition advice. For reusable visualizations, save data with roost_save_dataset and use dataset-chart blocks: datasetKey, style (line/bar/stacked-bar/area/donut/scatter), x column key, series [{column,label}]. Series must be numeric; scatter x must be numeric; series labels must be unique; bar/stacked-bar/donut category labels must be unique; donut supports up to 24 categories, exactly one series, and a positive total; area, stacked-bar, and donut require nonnegative values. Empty datasets show an empty state. No executable HTML. Use a stable lowercase key such as project-status. Omit expectedRevision only for a new key; read first and pass the current revision to update. Save complete desired content. Saving persists content without creating chat messages. For a user-requested tracker, call roost_show_dashboard with its key after saving to render the interactive tracker inline; do not duplicate it in prose. Existing user-authorized automations can refresh saved content without showing a chat card. Never invent fresh measurements or imply data was checked when it was not. Dashboards must already be enabled in Settings.",
    inputSchema: JSONSchema.make(SaveDashboard) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_show_dashboard",
    description:
      "Display one of your saved trackers as an interactive card inline in the current user conversation. Supply only its saved key after roost_save_dashboard; saving alone stays quiet. For user-requested trackers, save the tracker then show it here so they can use it immediately. This references current saved data, not copied content. Repeat calls for the same key in the same turn are idempotent. The active user chat run determines the conversation; you cannot choose another conversation. Not available to automations, delegated work, reflections, or stopped runs. After showing it, avoid repeating the tracker contents in prose.",
    inputSchema: JSONSchema.make(ShowDashboard) as unknown as JsonValue,
  },
  {
    type: "function",
    name: "roost_delete_dashboard",
    description:
      "Remove one of your dashboard widgets when the user asks. Read its current revision first and supply expectedRevision. This removes its saved content, not any external source data.",
    inputSchema: JSONSchema.make(DeleteDashboard) as unknown as JsonValue,
  },
];
