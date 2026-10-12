import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { RoostAPI } from "../src/api";
import { DesktopCompanion } from "../src/companion";
import { LocalTools } from "../src/local-tools";

test("the companion aborts an in-flight helper when its run disappears from the next poll", async () => {
  const agentId = randomUUID();
  const requestId = randomUUID();
  const lease = randomUUID();
  let delivered = false;
  let aborted!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const tools = new LocalTools(
    "fixture-helper",
    async (_program, _args, _input, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            reject(new Error("Stopped"));
          },
          { once: true },
        );
      }),
  );
  const grants = { agentId, chats: [], computerUntil: Date.now() + 60000 };
  tools.setGrants(grants);
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.endsWith("/session"))
      response.end(JSON.stringify({ apiVersion: 1 }));
    else if (request.url?.endsWith("/connect"))
      response.end(JSON.stringify({ protocolVersion: 1, lease }));
    else if (request.url?.endsWith("/poll")) {
      const requests = delivered
        ? []
        : [
            {
              id: requestId,
              agentId,
              runId: randomUUID(),
              expiresAt: Date.now() + 15000,
              call: {
                tool: "roost_desktop_computer",
                input: { action: "screenshot" },
              },
            },
          ];
      response.end(
        JSON.stringify({
          requests,
          activeRequestIds: delivered ? [] : [requestId],
        }),
      );
      delivered = true;
    } else response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const companion = new DesktopCompanion(
    new RoostAPI(
      `http://127.0.0.1:${address.port}`,
      `roost_mobile_${"a".repeat(43)}`,
    ),
    tools,
    () => grants,
    () => {},
    () => {},
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await companion.start();
    await Promise.race([
      cancelled,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("The helper was not cancelled.")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    await companion.stop();
    server.close();
  }
});
