import { Schema } from "effect";

export const Character = Schema.Literal("moss", "wisp", "peach");
const Name = Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(60));

const Instructions = Schema.Trim.pipe(
  Schema.minLength(1),
  Schema.maxLength(8000),
);

const Model = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));

export const CreateAgentInput = Schema.Struct({
  id: Schema.UUID,
  name: Name,
  instructions: Instructions,
  character: Character,
  model: Model,
});

export type CreateAgentInput = typeof CreateAgentInput.Type;

export const Agent = Schema.Struct({
  ...CreateAgentInput.fields,
  createdAt: Schema.String,
});

export type Agent = typeof Agent.Type;
