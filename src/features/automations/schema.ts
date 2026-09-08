import { Schema } from "effect";

const Short = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(200));
const DateOnly = Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/));

const DateWindow = {
  startsOn: Schema.optional(DateOnly),
  endsOn: Schema.optional(DateOnly),
};

export const Schedule = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("once"),
    at: Schema.String,
    timezone: Schema.optional(Short),
  }),
  Schema.Struct({
    kind: Schema.Literal("interval"),
    ...DateWindow,
    timezone: Schema.optional(Short),
    minutes: Schema.Number.pipe(Schema.int(), Schema.between(1, 525600)),
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    ...DateWindow,
    time: Schema.String.pipe(Schema.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    timezone: Short,
    days: Schema.Array(
      Schema.Number.pipe(Schema.int(), Schema.between(0, 6)),
    ).pipe(Schema.minItems(1), Schema.maxItems(7)),
  }),
  Schema.Struct({
    kind: Schema.Literal("cron"),
    expression: Short,
    timezone: Short,
    ...DateWindow,
  }),
);

export type Schedule = typeof Schedule.Type;

export const AutomationInput = Schema.Struct({
  agentId: Schema.UUID,
  id: Schema.UUID,
  name: Short,
  prompt: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(16000)),
  model: Schema.optional(Schema.NullOr(Short)),
  schedule: Schedule,
  notification: Schema.Literal("always", "when-needed"),
});

export type AutomationInput = typeof AutomationInput.Type;

export const Automation = Schema.Struct({
  ...AutomationInput.fields,
  revision: Schema.Number,
  enabled: Schema.Boolean,
  nextRunAt: Schema.NullOr(Schema.Number),
});

export type Automation = typeof Automation.Type;
