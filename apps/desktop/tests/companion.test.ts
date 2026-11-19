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

import type { ServerResponse } from "node:http";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, label: string) {
  const end = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await wait(10);
  }
}

test("an older result upload cannot erase cancellation tracking for the next helper", async () => {
  const agentId = randomUUID();
  const runId = randomUUID();
  const lease = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  let firstDelivered = false;
  let secondDelivered = false;
  let secondCancelled = false;
  let cancellationPolls = 0;
  let firstResultResponse: ServerResponse | undefined;
  let helperSignal: AbortSignal | undefined;
  let captures = 0;
  let firstResultCompleted = false;
  const tools = new LocalTools(
    "fixture-helper",
    async (_program, _args, _input, signal) => {
      captures++;
      if (captures === 1)
        return JSON.stringify({
          dataURL: "data:image/jpeg;base64,AA==",
          width: 100,
          height: 100,
          bounds: { x: 0, y: 0, width: 100, height: 100 },
        });
      helperSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("Fixture cancelled")),
          { once: true },
        );
      });
    },
    "fixture-imsg",
  );
  const grants = { agentId, chats: [], computerUntil: Date.now() + 60000 };
  tools.setGrants(grants);
  const request = (id: string) => ({
    id,
    agentId,
    runId,
    expiresAt: Date.now() + 15000,
    call: { tool: "roost_desktop_computer", input: { action: "screenshot" } },
  });
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("/session"))
      res.end(JSON.stringify({ apiVersion: 1 }));
    else if (req.url?.endsWith("/connect"))
      res.end(JSON.stringify({ protocolVersion: 1, lease }));
    else if (req.url?.endsWith("/poll")) {
      if (!firstDelivered) {
        firstDelivered = true;
        res.end(
          JSON.stringify({
            requests: [request(firstId)],
            activeRequestIds: [firstId],
          }),
        );
      } else if (firstResultResponse && !secondDelivered) {
        secondDelivered = true;
        res.end(
          JSON.stringify({
            requests: [request(secondId)],
            activeRequestIds: [secondId],
          }),
        );
      } else {
        if (secondCancelled) cancellationPolls++;
        res.end(
          JSON.stringify({
            requests: [],
            activeRequestIds: secondCancelled ? [] : [secondId],
          }),
        );
      }
    } else if (req.url?.endsWith("/result")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (body.id === firstId) firstResultResponse = res;
      else res.end("{}");
    } else res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  class ObservedAPI extends RoostAPI {
    override async request(path: string, data?: unknown) {
      const value = await super.request(path, data);
      if (path === "companion/result" && !firstResultCompleted)
        firstResultCompleted = true;
      return value;
    }
  }
  const companion = new DesktopCompanion(
    new ObservedAPI(
      `http://127.0.0.1:${address.port}`,
      `roost_mobile_${"a".repeat(43)}`,
    ),
    tools,
    () => grants,
    () => {},
    () => {},
  );
  try {
    await companion.start();
    await until(
      () => Boolean(helperSignal),
      "second local helper started before first result response",
    );
    firstResultResponse!.end("{}");
    await until(() => firstResultCompleted, "first result response completed");
    await wait(30);
    secondCancelled = true;
    await until(
      () => cancellationPolls >= 2,
      "two polls reported the second run request cancelled",
    );
    assert.equal(
      helperSignal!.aborted,
      true,
      "Cancellation must abort the newer helper despite an older upload completing",
    );
  } finally {
    await companion.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
