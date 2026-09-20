import { Effect } from "effect";
import {
  type CreateDashboardTracker,
  type DashboardAction,
  decodeCreateDashboardTracker,
  decodeDashboardAction,
} from "../../features/dashboards/actions";
import type {
  DashboardBlock,
  DashboardWidget,
} from "../../features/dashboards/schema";
import { AgentStoreError } from "../agents/store.server";
import { listDashboards, saveDashboard } from "./store.server";

const conflict = (
  message = "This dashboard changed. Refresh it before trying again.",
) => new AgentStoreError({ message: `DASHBOARD_CONFLICT: ${message}` });
const invalid = (message: string) => new AgentStoreError({ message });

function duplicateAddition(
  widgets: readonly DashboardWidget[],
  input: DashboardAction,
) {
  if (input.action !== "add-todo" && input.action !== "add-meal") return null;
  for (const widget of widgets) {
    for (const block of widget.blocks) {
      if (block.type !== "todo-list" && block.type !== "calorie-log") continue;
      const item = (
        block.type === "todo-list" ? block.items : block.entries
      ).find((item) => item.id === input.id);
      if (!item) continue;
      if (
        widget.key !== input.key ||
        block.id !== input.blockId ||
        input.expectedRevision > widget.revision
      )
        throw conflict(
          "This item ID is already in use. Refresh the dashboard before adding another item.",
        );
      if (
        input.action === "add-todo" &&
        block.type === "todo-list" &&
        item.label === input.label
      )
        return widget;
      if (
        input.action === "add-meal" &&
        block.type === "calorie-log" &&
        "date" in item &&
        item.date === input.date &&
        item.label === input.label &&
        item.calories === input.calories
      )
        return widget;
      throw conflict(
        "This item changed. Refresh the dashboard before trying again.",
      );
    }
  }
  return null;
}

function applyAction(
  block: DashboardBlock,
  input: DashboardAction,
): DashboardBlock {
  switch (input.action) {
    case "add-todo":
      if (block.type !== "todo-list")
        throw invalid("This block is not an editable to-do list.");
      if (block.items.length >= 100)
        throw invalid(
          "This list is full. Remove a to-do before adding another.",
        );
      return {
        ...block,
        items: [
          ...block.items,
          { id: input.id, label: input.label, done: false },
        ],
      };
    case "set-todo":
    case "delete-todo":
      if (block.type !== "todo-list")
        throw invalid("This block is not an editable to-do list.");
      if (!block.items.some((item) => item.id === input.id))
        throw conflict(
          "This to-do is no longer available. Refresh the dashboard.",
        );
      return {
        ...block,
        items:
          input.action === "delete-todo"
            ? block.items.filter((item) => item.id !== input.id)
            : block.items.map((item) =>
                item.id === input.id ? { ...item, done: input.done } : item,
              ),
      };
    case "add-meal":
      if (block.type !== "calorie-log")
        throw invalid("This block is not an editable calorie log.");
      if (block.entries.length >= 200)
        throw invalid(
          "This log is full. Remove an entry before adding another.",
        );
      return {
        ...block,
        entries: [
          ...block.entries,
          {
            id: input.id,
            date: input.date,
            label: input.label,
            calories: input.calories,
          },
        ],
      };
    case "delete-meal":
      if (block.type !== "calorie-log")
        throw invalid("This block is not an editable calorie log.");
      if (!block.entries.some((item) => item.id === input.id))
        throw conflict(
          "This entry is no longer available. Refresh the dashboard.",
        );
      return {
        ...block,
        entries: block.entries.filter((item) => item.id !== input.id),
      };
  }
}

/** Each action changes one current block, preserving every unrelated saved block. */
export const updateDashboardContent = (
  agentId: string,
  input: DashboardAction,
) =>
  Effect.gen(function* () {
    const data = yield* Effect.try({
      try: () => decodeDashboardAction(input),
      catch: () =>
        invalid("Provide a valid dashboard action, item and current revision."),
    });
    // These store reads enforce agent ownership, maintenance and dashboard enablement.
    const widgets = yield* listDashboards(agentId);
    const widget = widgets.find((widget) => widget.key === data.key);
    if (!widget) return yield* Effect.fail(invalid("Dashboard not found."));
    const retry = yield* Effect.try({
      try: () => duplicateAddition(widgets, data),
      catch: (error) =>
        error instanceof AgentStoreError
          ? error
          : invalid("Could not update this dashboard item."),
    });
    if (retry) return retry;
    if (widget.revision !== data.expectedRevision)
      return yield* Effect.fail(conflict());
    const index = widget.blocks.findIndex(
      (block) => "id" in block && block.id === data.blockId,
    );
    if (index < 0)
      return yield* Effect.fail(
        invalid("This dashboard block is no longer available."),
      );
    const block = yield* Effect.try({
      try: () => applyAction(widget.blocks[index]!, data),
      catch: (error) =>
        error instanceof AgentStoreError
          ? error
          : invalid("Could not update this dashboard item."),
    });
    const blocks = widget.blocks.map((current, position) =>
      position === index ? block : current,
    );
    return yield* saveDashboard(agentId, {
      key: widget.key,
      title: widget.title,
      blocks,
      expectedRevision: data.expectedRevision,
    }).pipe(
      Effect.mapError((error) =>
        error.message === "This dashboard changed. Read it again before saving."
          ? conflict()
          : error,
      ),
    );
  });

function existingTracker(
  widget: DashboardWidget | undefined,
  data: CreateDashboardTracker,
) {
  if (!widget) return null;
  const block = widget.blocks[0];
  if (
    widget.title === data.title &&
    widget.blocks.length === 1 &&
    block &&
    "id" in block &&
    block.id === "items" &&
    block.type === (data.kind === "todo" ? "todo-list" : "calorie-log")
  )
    return widget;
  throw conflict(
    "That tracker key is already in use. Refresh before creating another tracker.",
  );
}

/** A stable client key makes a lost create response safe to retry without duplicates. */
export const createDashboardTracker = (
  agentId: string,
  input: CreateDashboardTracker,
) =>
  Effect.gen(function* () {
    const data = yield* Effect.try({
      try: () => decodeCreateDashboardTracker(input),
      catch: () =>
        invalid(
          "Provide a tracker type, a stable key and a title of at most 100 characters.",
        ),
    });
    const lookup = () =>
      listDashboards(agentId).pipe(
        Effect.flatMap((widgets) =>
          Effect.try({
            try: () =>
              existingTracker(
                widgets.find((widget) => widget.key === data.key),
                data,
              ),
            catch: (error) =>
              error instanceof AgentStoreError
                ? error
                : invalid("Could not create this tracker."),
          }),
        ),
      );
    const existing = yield* lookup();
    if (existing) return existing;
    return yield* saveDashboard(agentId, {
      key: data.key,
      title: data.title,
      blocks:
        data.kind === "todo"
          ? [{ type: "todo-list", id: "items", items: [] }]
          : [{ type: "calorie-log", id: "items", entries: [] }],
    }).pipe(
      Effect.catchAll((error) => {
        if (
          error.message !==
          "This dashboard changed. Read it again before saving."
        )
          return Effect.fail(error);
        // Resolve only the same successful creation; never reapply a write after a conflict.
        return lookup().pipe(
          Effect.flatMap((widget) =>
            widget ? Effect.succeed(widget) : Effect.fail(conflict()),
          ),
        );
      }),
    );
  });
