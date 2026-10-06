import { Schema } from "effect";

export const ModelName = Schema.Trim.pipe(
  Schema.minLength(1),
  Schema.maxLength(200),
);
export const ReasoningEffort = Schema.Trim.pipe(
  Schema.minLength(1),
  Schema.maxLength(50),
);
export const AgentModelInput = Schema.Struct({
  agentId: Schema.UUID,
  model: ModelName,
  reasoningEffort: Schema.NullOr(ReasoningEffort),
  expectedModel: ModelName,
  expectedReasoningEffort: Schema.NullOr(ReasoningEffort),
});
