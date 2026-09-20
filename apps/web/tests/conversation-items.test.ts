import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import {
  Item,
  messageFromItem,
} from "../src/server/codex/conversation-items.server";

test("thinking exposes only the supplied summary, never raw reasoning content", () => {
  const item = Schema.decodeUnknownSync(Item)({
    type: "reasoning",
    id: "r",
    summary: ["Checking the workspace."],
    content: ["private reasoning"],
  });
  assert.equal(messageFromItem(item, true)?.text, "Checking the workspace.");
  assert.equal(messageFromItem(item, true)?.status, "inProgress");
  assert.equal(
    messageFromItem({
      type: "reasoning",
      id: "r",
      content: ["private reasoning"],
    })?.text,
    "",
  );
});

test("command and tool results retain output and failure state on history reload", () => {
  assert.deepEqual(
    messageFromItem({
      type: "commandExecution",
      id: "c",
      command: "pwd",
      aggregatedOutput: "permission denied",
      exitCode: 1,
      status: "completed",
    }),
    {
      id: "c",
      role: "activity",
      title: "Command",
      details: "pwd",
      text: "permission denied",
      status: "failed",
    },
  );
  const tool = messageFromItem({
    type: "mcpToolCall",
    id: "m",
    server: "docs",
    tool: "search",
    arguments: { query: "hello" },
    result: { text: "found" },
    status: "completed",
  });
  assert.equal(tool?.title, "docs / search");
  assert.match(tool?.details ?? "", /hello/);
  assert.match(tool?.text ?? "", /found/);
});

test("tool display omits large inline media without changing the model response", () => {
  const encoded = "a".repeat(2_000_000);
  const imageUrl = `data:image/png;base64,${encoded}`;
  const contentItems = [
    { type: "inputText", text: "Desktop screenshot: 1280 × 720 pixels." },
    { type: "inputImage", imageUrl },
    { type: "inputAudio", audioUrl: `data:audio/wav;base64,${encoded}` },
    { type: "inputText", text: "The page is ready." },
  ];
  const original = Object.freeze({
    type: "dynamicToolCall",
    id: "screenshot",
    name: "roost_computer",
    arguments: { action: "screenshot" },
    contentItems,
    success: true,
  });
  const message = messageFromItem(original)!;
  assert.ok(message.text.length < 1_000);
  assert.match(message.text, /1280 × 720/);
  assert.match(message.text, /The page is ready/);
  assert.match(message.text, /Inline media omitted from display/);
  assert.doesNotMatch(message.text, /data:(image|audio)|a{100}/);
  assert.equal(original.contentItems, contentItems);
  assert.equal(original.contentItems[1]!.imageUrl, imageUrl);
  assert.equal(original.contentItems[2]!.audioUrl!.length, 2_000_022);
});

test("MCP binary blocks are omitted in structured results and JSON arguments", () => {
  const payload = {
    content: [
      { type: "text", text: "Found an image and its description." },
      { type: "image", mimeType: "image/png", data: "c".repeat(10_000) },
      { type: "audio", mimeType: "audio/wav", data: "d".repeat(10_000) },
      { type: "input_image", image_url: { url: "data:image/png;base64,abc" } },
    ],
    url: "https://example.com/image.png",
    data: "ordinary data is retained",
  };
  const message = messageFromItem({
    type: "mcpToolCall",
    id: "media",
    server: "images",
    tool: "inspect",
    arguments: JSON.stringify({ nested: payload }),
    result: payload,
  })!;
  for (const field of [message.text, message.details!]) {
    assert.match(field, /Found an image and its description/);
    assert.match(field, /Binary media omitted from display/);
    assert.match(field, /https:\/\/example.com\/image.png/);
    assert.match(field, /ordinary data is retained/);
    assert.doesNotMatch(field, /data:image|c{100}|d{100}/);
  }
  assert.equal(payload.content[1]!.data!.length, 10_000);
});

test("activity display bounds deep, broad, and oversized tool output", () => {
  let nested: unknown = { text: "too deep" };
  for (let index = 0; index < 20; index++) nested = { nested };
  const display = (result: unknown) =>
    messageFromItem({ type: "dynamicToolCall", id: "bounded", result })!.text;
  assert.match(display(nested), /Display nesting omitted/);
  const broad = display(Array.from({ length: 10_000 }, (_, index) => index));
  assert.match(broad, /Display output truncated/);
  assert.ok(broad.length < 3_000);
  const long = display({ output: "x".repeat(1_000_000) });
  assert.ok(long.length <= 24_000);
  assert.match(long, /Display output truncated/);
  const oversizedJson = display(
    JSON.stringify({ type: "image", data: "y".repeat(1_000_000) }),
  );
  assert.match(oversizedJson, /JSON display omitted/);
  assert.doesNotMatch(oversizedJson, /y{100}/);
  assert.ok(display({ ["k".repeat(1_000_000)]: "value" }).length < 300);
});

test("activity errors and command output stay readable with explicit limits", () => {
  const failed = messageFromItem({
    type: "dynamicToolCall",
    id: "failed",
    error: {
      message: "Connection failed",
      screenshot: "data:image/png;base64,abc",
    },
    success: false,
  })!;
  assert.equal(failed.status, "failed");
  assert.match(failed.text, /Connection failed/);
  assert.doesNotMatch(failed.text, /data:image/);
  const command = messageFromItem({
    type: "commandExecution",
    id: "command",
    command: "cat output.log",
    aggregatedOutput: `Important error\n${"z".repeat(1_000_000)}`,
    exitCode: 1,
  })!;
  assert.equal(command.details, "cat output.log");
  assert.equal(command.status, "failed");
  assert.match(command.text, /^Important error/);
  assert.ok(command.text.length <= 24_000);
  assert.match(command.text, /Display output truncated/);
});

test("user and assistant message content is never sanitized or truncated", () => {
  const text = `data:image/png;base64,${"a".repeat(30_000)}`;
  assert.equal(
    messageFromItem({ type: "agentMessage", id: "answer", text })!.text,
    text,
  );
  assert.equal(
    messageFromItem({
      type: "userMessage",
      id: "request",
      content: [{ type: "text", text }],
    })!.text,
    text,
  );
});
