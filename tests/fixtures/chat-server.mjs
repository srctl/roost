#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const path = join(
  process.env.CODEX_HOME ?? process.env.ROOST_DATA_DIR,
  "fake-thread.json",
);
let thread = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { id: randomUUID(), turns: [] };
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const threadPath = (id) =>
  join(process.env.CODEX_HOME ?? process.env.ROOST_DATA_DIR, `fake-${id}.json`);
const persist = () => {
  writeFileSync(path, JSON.stringify(thread));
  writeFileSync(threadPath(thread.id), JSON.stringify(thread));
};
const pendingTools = new Map();
const requestTool = (params) =>
  new Promise((resolve) => {
    const id = randomUUID();
    pendingTools.set(id, resolve);
    send({ id, method: "item/tool/call", params });
  });
createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (!method) {
    const resolve = pendingTools.get(id);
    pendingTools.delete(id);
    resolve?.(message);
    return;
  }
  if (method === "account/read" || method === "account/login/start") {
    send({ id, result: {} });
    return;
  }
  if (method === "config/read") {
    send({ id, result: { config: { features: { apps: true }, apps: {} } } });
    return;
  }
  if (method === "initialized") return;
  if (method === "initialize") {
    send({ id, result: {} });
    return;
  }
  if (method === "thread/inject_items") {
    thread.instructionUpdates = [
      ...(thread.instructionUpdates ?? []),
      ...params.items,
    ];
    persist();
    send({ id, result: {} });
    return;
  }
  if (params?.threadId && existsSync(threadPath(params.threadId)))
    thread = JSON.parse(readFileSync(threadPath(params.threadId), "utf8"));
  if (method === "thread/start") {
    thread = { id: randomUUID(), turns: [] };
    thread.options = params;
    thread.environment = {
      home: process.env.CODEX_HOME,
      sqliteHome: process.env.CODEX_SQLITE_HOME,
      cwd: process.cwd(),
      args: process.argv.slice(2),
    };
  }
  if (method.startsWith("thread/")) {
    persist();
    send({ id, result: { thread } });
    return;
  }
  if (method === "turn/interrupt") {
    send({ id, result: {} });
    return;
  }
  if (method === "turn/start") {
    const turn = {
      id: `turn-${thread.turns.length}`,
      status: "completed",
      items: [
        {
          type: "userMessage",
          id: `${thread.id}-user-${thread.turns.length}`,
          clientId: params.clientUserMessageId,
          content: params.input,
        },
        {
          type: "agentMessage",
          id: `${thread.id}-reply-${thread.turns.length}`,
          text: "Hello there.",
        },
      ],
    };
    if (params.input[0].text === "soul") {
      const call = {
        threadId: thread.id,
        turnId: turn.id,
        callId: "soul-call",
        namespace: null,
        tool: "roost_read_soul",
        arguments: {},
      };
      const read = await requestTool(call);
      const soul = JSON.parse(read.result.contentItems[0].text);
      const update = await requestTool({
        ...call,
        tool: "roost_update_soul",
        arguments: {
          revision: soul.revision,
          reason: "The user asked for concise answers",
          edits: [
            { before: "## Voice", after: "## Voice\nKeep answers concise." },
          ],
        },
      });
      const foreign = await requestTool({
        ...call,
        threadId: "another-thread",
      });
      thread.toolChecks = {
        updated: update.result.success,
        foreignRejected: !!foreign.error,
      };
    }
    if (params.input[0].text === "quiet")
      turn.items[1].text = "ROOST_NO_UPDATE";
    if (params.input[0].text === "delayed")
      await new Promise((resolve) => setTimeout(resolve, 200));
    if (params.input[0].text === "slow") {
      send({ id, result: { turn: { ...turn, status: "inProgress" } } });
      return;
    }
    if (params.input[0].text === "activity") {
      const activity = {
        type: "commandExecution",
        id: "cmd",
        command: "printf hello",
        aggregatedOutput: "hello",
        status: "completed",
        exitCode: 0,
      };
      turn.items.push(activity);
      send({
        method: "item/started",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          item: { ...activity, aggregatedOutput: "", status: "inProgress" },
        },
      });
      send({
        method: "item/commandExecution/outputDelta",
        params: {
          threadId: thread.id,
          turnId: turn.id,
          itemId: "cmd",
          delta: "hello",
        },
      });
      send({
        method: "item/completed",
        params: { threadId: thread.id, turnId: turn.id, item: activity },
      });
    }
    thread.turns.push(turn);
    persist();
    // Deliberately notify before acknowledging turn/start to exercise the race.
    send({
      method: "item/agentMessage/delta",
      params: {
        threadId: thread.id,
        turnId: turn.id,
        itemId: turn.items[1].id,
        delta: "Hello ",
      },
    });
    send({
      method: "item/agentMessage/delta",
      params: {
        threadId: thread.id,
        turnId: turn.id,
        itemId: turn.items[1].id,
        delta: "there.",
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: thread.id,
        turn: {
          ...turn,
          items: turn.items.filter((item) => item.type !== "userMessage"),
        },
      },
    });
    send({ id, result: { turn } });
  }
});
