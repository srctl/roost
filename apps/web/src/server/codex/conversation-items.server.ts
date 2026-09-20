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

const DISPLAY_CHARACTERS = 24_000;
const DISPLAY_DEPTH = 8;
const DISPLAY_ENTRIES = 200;
const JSON_STRING_CHARACTERS = 128_000;
const omitted = "[Display output truncated.]";
const mediaUri = /data:(?:image|audio|video)\/[^,\s"'<>]+,[^\s"'<>]*/gi;

function truncate(text: string, limit: number) {
  return text.length <= limit
    ? text
    : `${text.slice(0, Math.max(0, limit - omitted.length))}${omitted}`;
}

// These are display copies only. The original tool response, including images
// used by the model, stays untouched. Never duplicate its binary payload into
// every Roost run snapshot as JSON text. Bound traversal before stringifying.
function print(value: unknown): string {
  if (value == null) return "";
  let characters = DISPLAY_CHARACTERS;
  let entries = DISPLAY_ENTRIES;
  const visit = (input: unknown, depth: number): unknown => {
    if (entries-- <= 0 || characters <= 0) return omitted;
    if (typeof input === "string") {
      if (/^\s*[[{]/.test(input)) {
        if (input.length > JSON_STRING_CHARACTERS)
          return "[JSON display omitted: exceeds 128,000 characters.]";
        try {
          if (depth >= DISPLAY_DEPTH) return "[Display nesting omitted.]";
          return visit(JSON.parse(input), depth + 1);
        } catch {
          // Ordinary text beginning with a bracket is still displayable text.
        }
      }
      const text = truncate(
        input.replace(mediaUri, "[Inline media omitted from display.]"),
        characters,
      );
      characters -= text.length;
      return text;
    }
    if (input == null || typeof input !== "object") return input;
    if (depth >= DISPLAY_DEPTH) return "[Display nesting omitted.]";
    if (Array.isArray(input)) {
      const result: unknown[] = [];
      for (const child of input) {
        if (entries <= 0 || characters <= 0) {
          result.push(omitted);
          break;
        }
        result.push(visit(child, depth + 1));
      }
      return result;
    }
    const object = input as Record<string, unknown>;
    const binaryContent =
      object.type === "image" ||
      object.type === "audio" ||
      (object.type === "base64" &&
        typeof object.media_type === "string" &&
        /^(image|audio|video)\//.test(object.media_type));
    const result: Record<string, unknown> = Object.create(null);
    for (const key in object) {
      if (!Object.hasOwn(object, key)) continue;
      if (entries <= 0 || characters <= 0) {
        result["Display omitted"] = omitted;
        break;
      }
      const name = truncate(key, Math.min(256, characters));
      characters -= name.length;
      result[name] =
        key === "data" && binaryContent && typeof object[key] === "string"
          ? "[Binary media omitted from display.]"
          : visit(object[key], depth + 1);
    }
    return result;
  };
  const display = visit(value, 0);
  return truncate(
    typeof display === "string"
      ? display
      : (JSON.stringify(display, null, 2) ?? ""),
    DISPLAY_CHARACTERS,
  );
}

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
      details: item.command === undefined ? undefined : print(item.command),
      text: print(item.aggregatedOutput),
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
