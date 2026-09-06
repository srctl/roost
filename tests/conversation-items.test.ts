import { test } from "node:test";
import assert from "node:assert/strict";
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
