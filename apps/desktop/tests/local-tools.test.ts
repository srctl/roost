import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { DesktopCall, DesktopRequest } from "@roost/desktop-protocol";
import { type Execute, LocalTools } from "../src/local-tools";

const agentId = randomUUID();
const request = (call: DesktopCall, agent = agentId): DesktopRequest => ({
  id: randomUUID(),
  agentId: agent,
  runId: randomUUID(),
  expiresAt: Date.now() + 15000,
  call,
});
test("Messages reads are scoped locally and cannot invoke send or arbitrary commands", async () => {
  const commands: string[][] = [];
  const tools = new LocalTools(
    "helper",
    async (_program, args) => {
      commands.push(args);
      return JSON.stringify({
        text: "Read me",
        sender_name: "Friend",
        attachment_path: "/secret",
      });
    },
    "imsg",
  );
  tools.setGrants({
    agentId,
    chats: [{ id: 12, label: "Shared" }],
    computerUntil: 0,
  });
  const result = await tools.handle(
    request({
      tool: "roost_desktop_messages",
      input: { action: "history", chatId: 12, limit: 10 },
    }),
  );
  assert.match(result.text, /Read me/);
  assert.doesNotMatch(result.text, /secret/);
  assert.deepEqual(commands, [
    ["history", "--chat-id", "12", "--limit", "10", "--json"],
  ]);
  await assert.rejects(
    tools.handle(
      request({
        tool: "roost_desktop_messages",
        input: { action: "history", chatId: 13, limit: 10 },
      }),
    ),
    /outside/,
  );
  await assert.rejects(
    tools.handle(
      request(
        { tool: "roost_desktop_messages", input: { action: "chats" } },
        randomUUID(),
      ),
    ),
    /outside/,
  );
  await assert.rejects(
    tools.handle(
      request({
        tool: "roost_desktop_messages",
        input: { action: "send", text: "No" },
      } as unknown as DesktopCall),
    ),
  );
});

test("computer input requires a fresh screenshot, maps Retina coordinates, and aborts on stop", async () => {
  const actions: Record<string, unknown>[] = [];
  const run: Execute = async (_program, _args, input) => {
    const action = JSON.parse(input!);
    actions.push(action);
    if (action.action === "screenshot")
      return JSON.stringify({
        dataURL: "data:image/jpeg;base64,AA==",
        width: 1000,
        height: 500,
        bounds: { x: 0, y: 0, width: 2000, height: 1000 },
      });
    return "{}";
  };
  const tools = new LocalTools("helper", run);
  tools.setGrants({ agentId, chats: [], computerUntil: Date.now() + 10000 });
  const click = request({
    tool: "roost_desktop_computer",
    input: { action: "click", x: 100, y: 200, button: "left", clicks: 1 },
  });
  await assert.rejects(tools.handle(click), /fresh screenshot/);
  await tools.handle(
    request({
      tool: "roost_desktop_computer",
      input: { action: "screenshot" },
    }),
  );
  await tools.handle({ ...click, id: randomUUID() });
  assert.deepEqual(actions[1], {
    action: "click",
    x: 200,
    y: 400,
    button: "left",
    clicks: 1,
  });
  await assert.rejects(
    tools.handle(
      request({
        tool: "roost_desktop_computer",
        input: { action: "move", x: 1001, y: 0 },
      }),
    ),
    /outside/,
  );
  tools.stop();
  await assert.rejects(tools.handle(click), /outside/);

  let begun!: () => void;
  const started = new Promise<void>((resolve) => {
    begun = resolve;
  });
  const waiting = new LocalTools(
    "helper",
    async (_program, _args, _input, signal) =>
      new Promise((_resolve, reject) => {
        begun();
        signal.addEventListener("abort", () => reject(new Error("Stopped")), {
          once: true,
        });
      }),
  );
  waiting.setGrants({ agentId, chats: [], computerUntil: Date.now() + 10000 });
  const pending = waiting.handle(
    request({
      tool: "roost_desktop_computer",
      input: { action: "screenshot" },
    }),
  );
  await started;
  waiting.stop();
  await assert.rejects(pending, /Stopped/);
});
