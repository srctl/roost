import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import {
  type LinkSpend,
  linkProvider,
} from "../src/server/payments/provider.server";
import { PaymentStore } from "../src/server/payments/store.server";
import { handlePaymentTool } from "../src/server/payments/tools.server";
import { enqueueChat } from "../src/server/runs/store.server";

test("mobile payment settings require a device token, reject browser origins, and share redacted owner state", async () => {
  const directory = mkdtempSync("/tmp/roost-payment-mobile-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const device = tokens.create("Payments test");
  const handle = createMobileHandler(async () => {});
  const request = async (
    path: string,
    options: {
      method?: string;
      auth?: boolean;
      origin?: string;
      body?: unknown;
    } = {},
  ) => {
    const response = await handle(
      new Request(`https://roost.example/api/mobile/v1/${path}`, {
        method: options.method ?? "GET",
        headers: {
          ...(options.auth === false
            ? {}
            : { Authorization: `Bearer ${device.secret}` }),
          ...(options.origin ? { Origin: options.origin } : {}),
          "Content-Type": "application/json",
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      }),
    );
    assert.ok(response);
    return {
      status: response.status,
      headers: response.headers,
      value: await response.json(),
    };
  };
  try {
    for (const [path, method] of [
      ["payments", "GET"],
      ["payments/connect", "POST"],
      ["payments/refresh", "POST"],
      ["payments/connection", "DELETE"],
    ]) {
      assert.equal((await request(path!, { method, auth: false })).status, 401);
      assert.equal(
        (await request(path!, { method, origin: "https://evil.example" }))
          .status,
        403,
      );
    }
    const pending = {
      deviceCode: "PRIVATE_DEVICE_CODE",
      userCode: "owner-code",
      verificationUrl: "https://link.com/verify",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5,
      nextPollAt: 0,
    };
    const store = new PaymentStore(directory, {
      ...linkProvider,
      beginConnection: async () => pending,
    });
    await store.connect();
    const response = await request("payments");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.value.connected, false);
    assert.equal(response.value.connection.userCode, "owner-code");
    assert.equal(
      JSON.stringify(response.value).includes("PRIVATE_DEVICE_CODE"),
      false,
    );
    assert.equal((await request("payments?agentId=bad")).status, 400);
    assert.equal((await request("payments/connect")).status, 405);
    assert.equal(
      (await request("payments/connection", { method: "DELETE" })).value
        .connection,
      undefined,
    );
    assert.equal((await request("payments")).value.connected, false);
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("payment tools require a live owned run and do not leak wallet credentials", async () => {
  const directory = mkdtempSync("/tmp/roost-payment-tools-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const agentId = randomUUID();
    await Effect.runPromise(
      saveAgent({
        id: agentId,
        name: "Buyer",
        instructions: "Help",
        model: "fixture",
        character: "moss",
      }),
    );
    const runId = randomUUID();
    await Effect.runPromise(
      enqueueChat({ agentId, messageId: runId, text: "Buy the approved book" }),
    );
    const signal = new AbortController();
    const context = { agentId, runId, signal: signal.signal };
    assert.equal(
      (await handlePaymentTool(context, "roost_payment_status", {})).success,
      false,
    );
    await Effect.runPromise(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET status='running' WHERE id=?").run(runId),
      ),
    );
    const provider = {
      ...linkProvider,
      beginConnection: async () => ({
        deviceCode: "PRIVATE",
        verificationUrl: "https://link.com/verify",
        userCode: "user-code",
        expiresAt: Date.now() + 60_000,
        intervalSeconds: 5,
        nextPollAt: 0,
      }),
      pollConnection: async () => ({
        status: "connected" as const,
        tokens: {
          accessToken: "PRIVATE_ACCESS",
          refreshToken: "PRIVATE_REFRESH",
          expiresAt: Date.now() + 3600_000,
        },
      }),
      wallet: async () => ({
        name: null,
        email: "owner@example.com",
        verificationUrl: null,
        verificationStatus: null,
      }),
      createSpend: async (): Promise<LinkSpend> => ({
        id: "lsrq_test",
        status: "approved",
        providerStatus: "approved",
        approvalUrl: null,
        actionUrl: null,
        activityUrl: null,
        merchantName: "Shop",
        merchantUrl: "https://shop.example",
        amount: 1200,
        currency: "usd",
        cardLast4: "4242",
        expiresAt: Date.now() + 60_000,
      }),
    };
    const store = new PaymentStore(directory, provider);
    await store.connect();
    await store.refresh();
    const purchase = await store.request(agentId, runId, {
      requestId: randomUUID(),
      merchantName: "Shop",
      merchantUrl: "https://shop.example",
      amount: 1200,
      currency: "usd",
      description: "One book shipped to the selected address.",
    });
    const status = await handlePaymentTool(context, "roost_payment_status", {});
    assert.equal(status.success, true);
    assert.equal(JSON.stringify(status).includes("PRIVATE"), false);
    const record = await handlePaymentTool(context, "roost_record_purchase", {
      id: purchase.id,
      orderReference: "Order 123",
      receiptUrl: "https://shop.example/orders/123",
    });
    assert.equal(record.success, true);
    assert.equal(store.read().purchases[0]!.status, "completed");
    const wrongAgent = await handlePaymentTool(
      { ...context, agentId: randomUUID() },
      "roost_payment_status",
      {},
    );
    assert.equal(wrongAgent.success, false);
    await Effect.runPromise(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET cancelRequested=1 WHERE id=?").run(runId),
      ),
    );
    assert.equal(
      (
        await handlePaymentTool(context, "roost_record_purchase", {
          id: purchase.id,
          orderReference: "other",
        })
      ).success,
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
