import { JSONSchema } from "effect";
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
      "Create or update a named dashboard widget from the user's tracking requirements. Discuss the useful content with the user: general trackers, project/task status, or metrics/trends. Compose bounded native blocks: markdown notes, metrics (label/value/note), tables (columns/rows), line or bar charts (title/style/points with label/value), links (http/https sources), tasks (label/status todo|doing|done). For reusable visualizations, save data with roost_save_dataset and use dataset-chart blocks: datasetKey, style (line/bar/stacked-bar/area/donut/scatter), x column key, series [{column,label}]. Series must be numeric; scatter x must be numeric; series labels must be unique; bar/stacked-bar/donut category labels must be unique; donut supports up to 24 categories, exactly one series, and a positive total; area, stacked-bar, and donut require nonnegative values. Empty datasets show an empty state. No executable HTML. Use a stable lowercase key such as project-status. Omit expectedRevision only for a new key; read first and pass the current revision to update. Save complete desired content. Updates persist outside conversation without creating chat messages; existing user-authorized automations can refresh them. Never invent fresh measurements or imply data was checked when it was not. Dashboards must already be enabled in Settings.",
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
