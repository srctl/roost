import { Schema } from "effect";

const label = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(100));
const text = Schema.String.pipe(Schema.maxLength(2000));
const url = Schema.String.pipe(
  Schema.maxLength(2000),
  Schema.filter(
    (value) => {
      try {
        return ["https:", "http:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: () => "Use an http or https source URL." },
  ),
);

export const DashboardBlock = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("markdown"),
    text: Schema.String.pipe(Schema.maxLength(12000)),
  }),
  Schema.Struct({
    type: Schema.Literal("metrics"),
    items: Schema.Array(
      Schema.Struct({ label, value: label, note: Schema.optional(text) }),
    ).pipe(Schema.minItems(1), Schema.maxItems(8)),
  }),
  Schema.Struct({
    type: Schema.Literal("table"),
    columns: Schema.Array(label).pipe(Schema.minItems(1), Schema.maxItems(8)),
    rows: Schema.Array(Schema.Array(text).pipe(Schema.maxItems(8))).pipe(
      Schema.maxItems(50),
    ),
  }).pipe(
    Schema.filter(
      (block) => block.rows.every((row) => row.length === block.columns.length),
      { message: () => "Every table row must have one cell per column." },
    ),
  ),
  Schema.Struct({
    type: Schema.Literal("chart"),
    title: label,
    style: Schema.Literal("line", "bar"),
    points: Schema.Array(
      Schema.Struct({
        label,
        value: Schema.Finite.pipe(Schema.between(-1e15, 1e15)),
      }),
    ).pipe(Schema.minItems(1), Schema.maxItems(100)),
  }),
  Schema.Struct({
    type: Schema.Literal("links"),
    items: Schema.Array(Schema.Struct({ label, url })).pipe(
      Schema.minItems(1),
      Schema.maxItems(12),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("tasks"),
    items: Schema.Array(
      Schema.Struct({
        label: text,
        status: Schema.Literal("todo", "doing", "done"),
      }),
    ).pipe(Schema.minItems(1), Schema.maxItems(40)),
  }),
);

export const DashboardKey = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9][a-z0-9-]{0,63}$/),
);
export const SaveDashboard = Schema.Struct({
  key: DashboardKey,
  title: label,
  blocks: Schema.Array(DashboardBlock).pipe(
    Schema.minItems(1),
    Schema.maxItems(12),
  ),
  expectedRevision: Schema.optional(
    Schema.NonNegativeInt.pipe(Schema.greaterThan(0)),
  ),
}).pipe(
  Schema.filter((widget) => JSON.stringify(widget).length <= 64000, {
    message: () => "Keep each dashboard widget under 64 KB.",
  }),
);

export const DeleteDashboard = Schema.Struct({
  key: DashboardKey,
  expectedRevision: Schema.NonNegativeInt.pipe(Schema.greaterThan(0)),
});
export const DashboardWidget = Schema.Struct({
  agentId: Schema.UUID,
  key: DashboardKey,
  title: label,
  blocks: Schema.Array(DashboardBlock),
  revision: Schema.NonNegativeInt.pipe(Schema.greaterThan(0)),
  updatedAt: Schema.Number,
});

export type DashboardBlock = typeof DashboardBlock.Type;
export type DashboardWidget = typeof DashboardWidget.Type;
export type SaveDashboard = typeof SaveDashboard.Type;
export type DeleteDashboard = typeof DeleteDashboard.Type;
