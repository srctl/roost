import { Schema } from "effect";

export const SendMessage = Schema.Struct({
  agentId: Schema.UUID,
  messageId: Schema.UUID,
  text: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(32000)),
});

export type SendMessage = typeof SendMessage.Type;

export const Message = Schema.Struct({
  id: Schema.String,
  role: Schema.Literal("user", "assistant", "notice", "activity"),
  text: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  details: Schema.optional(Schema.String),
  truncated: Schema.optional(Schema.Boolean),
  referenceId: Schema.optional(Schema.String),
  noticeKind: Schema.optional(
    Schema.Literal("soul", "automation", "run", "delegation"),
  ),
});

export type Message = typeof Message.Type;

export const ChatEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("history"),
    messages: Schema.Array(Message),
  }),
  Schema.Struct({
    type: Schema.Literal("delta"),
    id: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("message"), message: Message }),
  Schema.Struct({
    type: Schema.Literal("activityDelta"),
    id: Schema.String,
    title: Schema.String,
    text: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("done"), status: Schema.String }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
);

export type ChatEvent = typeof ChatEvent.Type;
