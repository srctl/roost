import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLinkProvider,
  LinkProviderError,
  type LinkTokens,
} from "../src/server/payments/provider.server";

const tokens: LinkTokens = {
  accessToken: "secret-access-token",
  refreshToken: "secret-refresh-token",
  expiresAt: Date.UTC(2030, 0, 1),
};
const start = Date.UTC(2026, 8, 20);
const device = {
  device_code: "private-device-code",
  user_code: "PEACH-MOSS",
  verification_uri: "https://link.com/verify",
  verification_uri_complete: "https://link.com/verify?code=PEACH-MOSS",
  expires_in: 900,
  interval: 5,
};
const spend = {
  id: "lsrq_test",
  merchant_name: "Bookshop",
  merchant_url: "https://bookshop.example/checkout",
  amount: 2500,
  currency: "usd",
  status: "pending_approval",
  approval_url: "https://app.link.com/approve/lsrq_test",
  created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:00:00Z",
};
const card = {
  id: "card_test",
  brand: "visa",
  number: "4000009990001984",
  cvc: "123",
  exp_month: 12,
  exp_year: 2029,
  valid_until: "2026-09-20T12:00:00Z",
};

function harness(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let time = start;
  const provider = createLinkProvider({
    now: () => time,
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      assert.ok(response, "Unexpected provider request");
      return new Response(
        response.body === undefined ? null : JSON.stringify(response.body),
        {
          status: response.status ?? 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });
  return {
    provider,
    calls,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test("Link device connection uses minimal scopes, enforces polling, and preserves rotation", async () => {
  const h = harness([
    { body: device },
    { status: 400, body: { error: "slow_down" } },
    {
      body: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "userinfo:read payment_methods.agentic",
      },
    },
    {
      body: {
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        token_type: "bearer",
        expires_in: 3600,
      },
    },
    {},
  ]);
  const pending = await h.provider.beginConnection();
  assert.equal(pending.deviceCode, device.device_code);
  assert.equal(pending.verificationUrl, device.verification_uri_complete);
  assert.equal(pending.expiresAt, start + 900_000);
  const login = new URLSearchParams(String(h.calls[0]!.init!.body));
  assert.equal(h.calls[0]!.url, "https://login.link.com/device/code");
  assert.equal(login.get("scope"), "userinfo:read payment_methods.agentic");
  assert.equal(login.get("connection_label"), "Roost");
  assert.equal(login.get("client_id"), "lwlpk_U7Qy7ThG69STZk");
  assert.deepEqual(await h.provider.pollConnection(pending), {
    status: "pending",
    pending,
  });
  assert.equal(h.calls.length, 1);
  h.advance(5000);
  const slow = await h.provider.pollConnection(pending);
  assert.equal(slow.status, "pending");
  if (slow.status !== "pending") return;
  assert.equal(slow.pending.intervalSeconds, 10);
  h.advance(9999);
  await h.provider.pollConnection(slow.pending);
  assert.equal(h.calls.length, 2);
  h.advance(1);
  const connected = await h.provider.pollConnection(slow.pending);
  assert.equal(connected.status, "connected");
  if (connected.status !== "connected") return;
  const rotated = await h.provider.refreshToken(connected.tokens);
  assert.equal(rotated.refreshToken, "rotated-refresh");
  assert.equal(rotated.scope, connected.tokens.scope);
  await h.provider.revoke(rotated);
  assert.equal(
    new URLSearchParams(String(h.calls.at(-1)!.init!.body)).get("token"),
    "rotated-refresh",
  );
  assert.ok(
    h.calls.every(
      (call) =>
        call.init?.redirect === "error" &&
        call.init.signal instanceof AbortSignal,
    ),
  );
});

test("Link connection rejects expired, declined, and untrusted verification responses", async () => {
  const h = harness([
    { body: device },
    {
      status: 400,
      body: { error: "access_denied", error_description: tokens.refreshToken },
    },
  ]);
  const pending = await h.provider.beginConnection();
  h.advance(5000);
  await assert.rejects(
    h.provider.pollConnection(pending),
    (error: unknown) =>
      error instanceof LinkProviderError &&
      error.code === "connection_declined" &&
      !JSON.stringify(error).includes(tokens.refreshToken),
  );
  h.advance(900_000);
  await assert.rejects(h.provider.pollConnection(pending), /expired/);
  assert.equal(h.calls.length, 2);
  for (const url of [
    "https://app.link.com.evil.example/approve",
    "https://user:pass@app.link.com/approve",
    "http://link.com/verify",
    "https://app.link.com:444/approve",
  ])
    await assert.rejects(
      harness([
        { body: { ...device, verification_uri_complete: url } },
      ]).provider.beginConnection(),
      /invalid response/,
    );
});

test("Link spend creation binds idempotency and requires provider approval while dropping credentials", async () => {
  const h = harness([
    {
      body: {
        ...spend,
        card,
        shared_payment_token: { id: "secret-spt" },
        link_pay_token: "secret-lpt",
      },
    },
  ]);
  const result = await h.provider.createSpend(
    tokens,
    {
      merchantName: spend.merchant_name,
      merchantUrl: spend.merchant_url,
      amount: spend.amount,
      currency: "USD",
      context:
        "The owner requested this specific book from this merchant. The checkout total includes shipping and taxes and will be approved in Link.",
      items: [{ name: "Book", quantity: 1, unitAmount: 2500 }],
    },
    "request-idempotency-123",
  );
  assert.equal(result.status, "awaiting_approval");
  const request = JSON.parse(String(h.calls[0]!.init!.body));
  assert.equal(h.calls[0]!.url, "https://api.link.com/spend_requests");
  assert.equal(request.idempotency_key, "request-idempotency-123");
  assert.equal(request.request_approval, true);
  assert.equal(request.credential_type, "card");
  assert.equal(request.currency, "usd");
  assert.equal(request.approve, undefined);
  assert.equal(request.approval_details, undefined);
  assert.equal(
    new Headers(h.calls[0]!.init!.headers).get("Authorization"),
    `Bearer ${tokens.accessToken}`,
  );
  const serialized = JSON.stringify(result);
  for (const secret of [
    card.number,
    card.cvc,
    "secret-spt",
    "secret-lpt",
    tokens.accessToken,
  ])
    assert.ok(!serialized.includes(secret));
});

test("Link status does not treat submitted as successful and fails closed for unknown states", async () => {
  const h = harness([
    { body: { ...spend, status: "submitted" } },
    { body: { ...spend, status: "new_state" } },
    { body: { ...spend, status: "succeeded" } },
  ]);
  assert.equal(
    (await h.provider.retrieveSpend(tokens, spend.id)).status,
    "processing",
  );
  assert.equal(
    (await h.provider.retrieveSpend(tokens, spend.id)).status,
    "failed",
  );
  assert.equal(
    (await h.provider.retrieveSpend(tokens, spend.id)).status,
    "completed",
  );
  await assert.rejects(
    h.provider.retrieveSpend(tokens, "../../userinfo"),
    /identifier/,
  );
  assert.equal(h.calls.length, 3);
});

test("Link credentials require approved unexpired matching purchase and stay server-only", async () => {
  const h = harness([
    { body: { ...spend, card } },
    {
      body: {
        ...spend,
        status: "approved",
        card: { ...card, valid_until: "2020-01-01T00:00:00Z" },
      },
    },
    { body: { ...spend, status: "approved", card } },
  ]);
  await assert.rejects(h.provider.card(tokens, spend.id), /not approved/);
  await assert.rejects(h.provider.card(tokens, spend.id), /expired/);
  const credential = await h.provider.card(tokens, spend.id);
  assert.equal(credential.number, card.number);
  assert.equal(credential.expMonth, card.exp_month);
  assert.equal(
    h.calls[2]!.url,
    "https://api.link.com/spend_requests/lsrq_test?include=card",
  );
});

test("Link SDK error bodies and transport causes never cross the provider boundary", async () => {
  const h = harness([
    {
      status: 500,
      body: {
        error: {
          message: `Failure ${tokens.accessToken} ${tokens.refreshToken} ${card.number}`,
        },
      },
    },
    { status: 401, body: { error: "Access expired" } },
  ]);
  await assert.rejects(
    h.provider.retrieveSpend(tokens, spend.id),
    (error: unknown) => {
      assert.ok(error instanceof LinkProviderError);
      assert.equal(error.code, "unavailable");
      for (const secret of [
        tokens.accessToken,
        tokens.refreshToken,
        card.number,
      ])
        assert.ok(!String(error.stack).includes(secret));
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  await assert.rejects(
    h.provider.wallet(tokens),
    (error: unknown) =>
      error instanceof LinkProviderError && error.code === "sign_in_required",
  );
});
