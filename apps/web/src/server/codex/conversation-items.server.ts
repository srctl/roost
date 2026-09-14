import { Schema } from "effect";
import type { Message } from "../../features/chat/schema";

// Keep provider payloads on the server; expose only displayable activity fields.
export const Item = Schema.Struct({
  type: Schema.String,
  id: Schema.String,
  text: Schema.optional(Schema.String),
  clientId: Schema.optional(Schema.NullOr(Schema.String)),
  content: Schema.optional(Schema.Unknown),
  summary: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  aggregatedOutput: Schema.optional(Schema.NullOr(Schema.String)),
  exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
  server: Schema.optional(Schema.String),
  tool: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  arguments: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Unknown),
  changes: Schema.optional(Schema.Unknown),
  action: Schema.optional(Schema.Unknown),
  contentItems: Schema.optional(Schema.Unknown),
  success: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

const TextParts = Schema.Array(
  Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
);

const print = (value: unknown) =>
  value == null
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);

export function messageFromItem(
  item: typeof Item.Type,
  running = false,
): Message | undefined {
  if (item.type === "userMessage") {
    const parts = Schema.decodeUnknownOption(TextParts)(item.content);

    return {
      id: item.clientId ?? item.id,
      role: "user",
      text:
        parts._tag === "Some"
          ? parts.value
              .filter((part) => part.type === "text")
              .map((part) => part.text ?? "")
              .join("\n")
          : "",
    };
  }
  if (item.type === "agentMessage")
    return { id: item.id, role: "assistant", text: item.text ?? "" };
  const base = {
    id: item.id,
    role: "activity" as const,
    status: running ? "inProgress" : (item.status ?? "completed"),
  };
  if (item.type === "reasoning")
    return {
      ...base,
      title: "Thinking",
      text: item.summary?.join("\n\n") ?? "",
    };
  if (item.type === "commandExecution")
    return {
      ...base,
      title: "Command",
      details: item.command,
      text: item.aggregatedOutput ?? "",
      status:
        item.exitCode != null && item.exitCode !== 0 ? "failed" : base.status,
    };
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall")
    return {
      ...base,
      title:
        [item.server, item.tool ?? item.name].filter(Boolean).join(" / ") ||
        "Tool call",
      details: print(item.arguments),
      text: print(item.error ?? item.result ?? item.contentItems),
      status: item.error || item.success === false ? "failed" : base.status,
    };
  if (item.type === "webSearch")
    return { ...base, title: "Web search", text: print(item.action) };
  if (item.type === "fileChange")
    return { ...base, title: "File changes", text: print(item.changes) };
  return undefined;
}
