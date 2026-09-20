import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import type { PurchaseInput } from "../src/features/payments/schema";
import {
  type LinkCard,
  type LinkConnectionResult,
  type LinkProvider,
  LinkProviderError,
  type LinkSpend,
  type LinkSpendInput,
  type LinkTokens,
  type PendingLinkConnection,
} from "../src/server/payments/provider.server";
import { PaymentStore } from "../src/server/payments/store.server";

class FakeLink implements LinkProvider {
  tokens: LinkTokens = {
    accessToken: "private-access-token-for-tests",
    refreshToken: "private-refresh-token-for-tests",
    expiresAt: Date.now() + 3_600_000,
  };
  credential: LinkCard = {
    number: "4000009990001984",
    cvc: "432",
    expMonth: 12,
    expYear: 2030,
    validUntil: new Date(Date.now() + 3_600_000).toISOString(),
  };
  spends = new Map<string, LinkSpend>();
  keys = new Map<string, string>();
  creates: Array<{ input: LinkSpendInput; key: string }> = [];
  events: string[] = [];
  beginCalls = 0;
  cardCalls = 0;
  refreshCalls = 0;
  revoked = false;
  rejectAuth = false;
  loseNextCreateResponse = false;

  async beginConnection(): Promise<PendingLinkConnection> {
    this.beginCalls++;
    this.revoked = false;
    return {
      deviceCode: "private-device-code-for-tests",
      verificationUrl: "https://app.link.com/verify",
      userCode: "PEACH-MOSS",
      expiresAt: Date.now() + 900_000,
      intervalSeconds: 5,
      nextPollAt: Date.now(),
    };
  }

  async pollConnection(): Promise<LinkConnectionResult> {
    return { status: "connected", tokens: { ...this.tokens } };
  }

  async refreshToken(previous: LinkTokens): Promise<LinkTokens> {
    this.refreshCalls++;
    this.checkAuth();
    this.tokens = {
      ...previous,
      accessToken: "rotated-private-access-token",
      refreshToken: "rotated-private-refresh-token",
      expiresAt: Date.now() + 3_600_000,
    };
    return { ...this.tokens };
  }

  async wallet() {
    this.checkAuth();
    return {
      name: "Owner",
      email: "owner@example.com",
      verificationUrl: null,
      verificationStatus: null,
    };
  }

  async createSpend(_tokens: LinkTokens, input: LinkSpendInput, key: string) {
    this.checkAuth();
    this.creates.push({ input: structuredClone(input), key });
    let id = this.keys.get(key);
    if (!id) {
      id = `lsrq_${this.keys.size + 1}`;
      this.keys.set(key, id);
      this.spends.set(id, {
        id,
        status: "awaiting_approval",
        providerStatus: "pending_approval",
        merchantName: input.merchantName,
        merchantUrl: input.merchantUrl,
        amount: input.amount,
        currency: input.currency,
        approvalUrl: `https://app.link.com/approve/${id}`,
        actionUrl: null,
        activityUrl: null,
        cardLast4: null,
        expiresAt: Date.now() + 600_000,
      });
    }
    if (this.loseNextCreateResponse) {
      this.loseNextCreateResponse = false;
      throw new LinkProviderError(
        "unavailable",
        "Link response was interrupted.",
      );
    }
    return { ...this.spends.get(id)! };
  }

  async retrieveSpend(_tokens: LinkTokens, id: string) {
    this.checkAuth();
    assert.ok(this.spends.has(id));
    return { ...this.spends.get(id)! };
  }

  async cancelSpend(_tokens: LinkTokens, id: string) {
    this.checkAuth();
    this.events.push(`cancel:${id}`);
    const current = this.spends.get(id)!;
    assert.ok(["awaiting_approval", "approved"].includes(current.status));
    const canceled: LinkSpend = {
      ...current,
      status: "cancelled",
      providerStatus: "canceled",
    };
    this.spends.set(id, canceled);
    return { ...canceled };
  }

  async card() {
    this.checkAuth();
    this.cardCalls++;
    return { ...this.credential };
  }

  async revoke() {
    this.checkAuth();
    this.events.push("revoke");
    this.revoked = true;
  }

  private checkAuth() {
    if (this.rejectAuth || this.revoked)
      throw new LinkProviderError("sign_in_required", "Reconnect Link.");
  }

  set(key: string, update: Partial<LinkSpend>) {
    const id = this.keys.get(`roost_${key}`)!;
    assert.ok(id);
    this.spends.set(id, { ...this.spends.get(id)!, ...update });
    return id;
  }
}

function purchase(): PurchaseInput {
  return {
    requestId: randomUUID(),
    merchantName: "Bookshop",
    merchantUrl: "https://bookshop.example/checkout",
    description: "One book shipped to the owner's chosen home address.",
    amount: 2500,
    currency: "usd",
  };
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "roost-payment-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const provider = new FakeLink();
  const store = new PaymentStore(directory, provider);
  return {
    directory,
    provider,
    store,
    agentId: randomUUID(),
    runId: randomUUID(),
    async connect() {
      await store.connect();
      await store.refresh();
      assert.equal(store.read().connected, true);
    },
  };
}

function expireSavedAccessToken(directory: string) {
  const db = new DatabaseSync(join(directory, "payments", "payments.sqlite"));
  try {
    const row = db.prepare("SELECT value FROM connection WHERE id=1").get()!;
    const connection = JSON.parse(String(row.value));
    connection.tokens.expiresAt = Date.now() - 1000;
    db.prepare("UPDATE connection SET value=? WHERE id=1").run(
      JSON.stringify(connection),
    );
  } finally {
    db.close();
  }
}

test("payment requests serialize across store instances and bind idempotency to unchanged purchases", async (t) => {
  const f = fixture(t);
  await f.connect();
  const input = purchase();
  const other = new PaymentStore(f.directory, f.provider);
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? f.store : other).request(f.agentId, f.runId, input),
    ),
  );
  assert.equal(f.provider.creates.length, 1);
  assert.ok(results.every((value) => value.id === input.requestId));
  assert.equal(f.store.read().purchases.length, 1);
  await assert.rejects(
    f.store.request(f.agentId, f.runId, { ...input, amount: 2501 }),
    /different purchase/,
  );
  await assert.rejects(
    f.store.request(f.agentId, f.runId, { ...input, description: "Two books" }),
    /different purchase/,
  );
  assert.equal(f.provider.creates.length, 1);
});

test("an ambiguous remote create is retried with the same durable key and body after restart", async (t) => {
  const f = fixture(t);
  await f.connect();
  const input = purchase();
  f.provider.loseNextCreateResponse = true;
  await assert.rejects(
    f.store.request(f.agentId, f.runId, input),
    /interrupted/,
  );
  assert.equal(f.store.read().purchases[0]!.status, "creating");
  const restarted = new PaymentStore(f.directory, f.provider);
  const result = await restarted.request(f.agentId, f.runId, input);
  assert.equal(result.status, "awaiting_approval");
  assert.equal(f.provider.creates.length, 2);
  assert.deepEqual(f.provider.creates[0], f.provider.creates[1]);
  assert.equal(f.provider.creates[0]!.key, `roost_${input.requestId}`);
  assert.equal(f.provider.spends.size, 1);
  assert.equal(restarted.read().purchases.length, 1);
});

test("agents cannot inspect, cancel, confirm, reuse, or fill another agent's purchase", async (t) => {
  const f = fixture(t);
  await f.connect();
  const input = purchase();
  await f.store.request(f.agentId, f.runId, input);
  f.provider.set(input.requestId, { status: "approved" });
  const otherAgent = randomUUID();
  await assert.rejects(
    f.store.inspect(otherAgent, input.requestId),
    /this agent/,
  );
  await assert.rejects(
    f.store.cancel(otherAgent, input.requestId),
    /this agent/,
  );
  await assert.rejects(
    f.store.record(otherAgent, input.requestId, "order"),
    /this agent/,
  );
  await assert.rejects(
    f.store.request(otherAgent, f.runId, input),
    /different purchase/,
  );
  await assert.rejects(
    f.store.withCard(otherAgent, input.requestId, async () =>
      assert.fail("Must not expose card"),
    ),
    /this agent/,
  );
  assert.equal(f.provider.cardCalls, 0);
  assert.deepEqual(f.store.read(otherAgent).purchases, []);
});

test("only approved purchases with exact merchant, amount, and currency can consume a card", async (t) => {
  const f = fixture(t);
  await f.connect();
  const input = purchase();
  await f.store.request(f.agentId, f.runId, input);
  const consume = async () =>
    assert.fail("Invalid purchase must not expose card");
  await assert.rejects(
    f.store.withCard(f.agentId, input.requestId, consume),
    /Approve/,
  );
  for (const update of [
    { amount: input.amount + 1 },
    { currency: "eur" },
    { merchantUrl: "https://different-merchant.example/checkout" },
    { amount: null },
    { currency: null },
    { merchantUrl: null },
  ]) {
    f.provider.set(input.requestId, {
      status: "approved",
      amount: input.amount,
      currency: input.currency,
      merchantUrl: input.merchantUrl,
      ...update,
    });
    await assert.rejects(
      f.store.withCard(f.agentId, input.requestId, consume),
      /changed|did not confirm/,
    );
  }
  assert.equal(f.provider.cardCalls, 0);
  f.provider.set(input.requestId, {
    status: "approved",
    amount: input.amount,
    currency: "usd",
    merchantUrl: input.merchantUrl,
  });
  const value = await f.store.withCard(
    f.agentId,
    input.requestId,
    async (card) => {
      assert.equal(card.number, f.provider.credential.number);
      return { filled: true };
    },
  );
  assert.deepEqual(value, { filled: true });
  assert.equal(f.provider.cardCalls, 1);
});

test("public state omits OAuth secrets and consumed cards are never persisted", async (t) => {
  const f = fixture(t);
  const pending = await f.store.connect();
  assert.equal(pending.connection!.userCode, "PEACH-MOSS");
  assert.ok(!JSON.stringify(pending).includes("private-device-code"));
  await f.store.refresh();
  const input = purchase();
  await f.store.request(f.agentId, f.runId, input);
  f.provider.set(input.requestId, { status: "approved" });
  await f.store.withCard(f.agentId, input.requestId, async () => undefined);
  const publicState = JSON.stringify(f.store.read());
  for (const secret of [
    f.provider.tokens.accessToken,
    f.provider.tokens.refreshToken,
    f.provider.credential.number,
    "private-device-code",
  ])
    assert.ok(!publicState.includes(secret));
  const database = join(f.directory, "payments", "payments.sqlite");
  assert.ok(
    !readFileSync(database).includes(Buffer.from(f.provider.credential.number)),
  );
  assert.equal(statSync(database).mode & 0o777, 0o600);
  assert.equal(statSync(join(f.directory, "payments")).mode & 0o777, 0o700);
});

test("expired cards and closed purchases never reach the credential consumer", async (t) => {
  const f = fixture(t);
  await f.connect();
  const input = purchase();
  await f.store.request(f.agentId, f.runId, input);
  f.provider.set(input.requestId, { status: "approved" });
  f.provider.credential.validUntil = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(
    f.store.withCard(f.agentId, input.requestId, async () =>
      assert.fail("Expired card exposed"),
    ),
    /expired/,
  );
  await f.store.cancel(f.agentId, input.requestId);
  assert.equal(f.store.read().purchases[0]!.status, "canceled");
  await assert.rejects(
    f.store.withCard(f.agentId, input.requestId, async () =>
      assert.fail("Canceled card exposed"),
    ),
    /closed/,
  );
});

test("disconnect cancels pending and approved requests, preserves processing, then revokes", async (t) => {
  const f = fixture(t);
  await f.connect();
  const inputs = Array.from({ length: 4 }, purchase);
  for (const input of inputs) await f.store.request(f.agentId, f.runId, input);
  const pendingId = f.provider.keys.get(`roost_${inputs[0]!.requestId}`)!;
  const approvedId = f.provider.set(inputs[1]!.requestId, {
    status: "approved",
  });
  f.provider.set(inputs[2]!.requestId, { status: "processing" });
  f.provider.set(inputs[3]!.requestId, {
    status: "requires_action",
    actionUrl: "https://app.link.com/verify",
  });
  const result = await f.store.disconnect();
  assert.equal(result.connected, false);
  assert.deepEqual(
    new Set(f.provider.events.slice(0, -1)),
    new Set([`cancel:${pendingId}`, `cancel:${approvedId}`]),
  );
  assert.equal(f.provider.events.at(-1), "revoke");
  assert.equal(f.provider.revoked, true);
  assert.deepEqual(
    result.purchases.map((p) => p.status).sort(),
    ["canceled", "canceled", "processing", "requires_action"].sort(),
  );
  assert.ok(
    !readFileSync(join(f.directory, "payments", "payments.sqlite")).includes(
      Buffer.from(f.provider.tokens.refreshToken),
    ),
  );
});

test("revoked authentication is removed and owner can reconnect without server intervention", async (t) => {
  const f = fixture(t);
  await f.connect();
  f.provider.rejectAuth = true;
  assert.equal((await f.store.disconnect()).connected, false);
  f.provider.rejectAuth = false;
  await f.connect();
  assert.equal(f.provider.beginCalls, 2);
  f.provider.rejectAuth = true;
  const pending = await f.store.connect();
  assert.equal(pending.connected, false);
  assert.ok(pending.connection);
  f.provider.rejectAuth = false;
  await f.store.refresh();
  assert.equal(f.store.read().connected, true);
  assert.equal(f.provider.beginCalls, 3);
});

test("expired token refresh rotates once under concurrent requests and revoked refresh permits reconnect", async (t) => {
  const f = fixture(t);
  await f.connect();
  expireSavedAccessToken(f.directory);
  assert.equal(f.provider.refreshCalls, 0);
  const input = purchase();
  await Promise.all(
    Array.from({ length: 5 }, () => f.store.request(f.agentId, f.runId, input)),
  );
  assert.equal(f.provider.refreshCalls, 1);
  assert.equal(f.provider.creates.length, 1);
  const saved = readFileSync(join(f.directory, "payments", "payments.sqlite"));
  assert.ok(saved.includes(Buffer.from("rotated-private-refresh-token")));
  assert.ok(!saved.includes(Buffer.from("private-refresh-token-for-tests")));
  f.provider.rejectAuth = true;
  expireSavedAccessToken(f.directory);
  await assert.rejects(
    f.store.inspect(f.agentId, input.requestId),
    /Reconnect/,
  );
  assert.equal(f.store.read().connected, false);
  f.provider.rejectAuth = false;
  await f.connect();
  await assert.rejects(
    f.store.inspect(f.agentId, input.requestId),
    /previous Link connection/,
  );
  await assert.rejects(
    f.store.withCard(f.agentId, input.requestId, async () =>
      assert.fail("Previous connection exposed card"),
    ),
    /not available/,
  );
});

test("processing and action-required states remain distinct; receipts require approved purchase", async (t) => {
  const f = fixture(t);
  await f.connect();
  const input = purchase();
  await f.store.request(f.agentId, f.runId, input);
  await assert.rejects(
    f.store.record(f.agentId, input.requestId, "order-1"),
    /approved/,
  );
  f.provider.set(input.requestId, {
    status: "requires_action",
    actionUrl: "https://app.link.com/verify",
  });
  let value = await f.store.inspect(f.agentId, input.requestId);
  assert.equal(value.status, "requires_action");
  assert.equal(value.approvalUrl, "https://app.link.com/verify");
  await assert.rejects(
    f.store.cancel(f.agentId, input.requestId),
    /cannot be canceled/,
  );
  f.provider.set(input.requestId, { status: "processing", actionUrl: null });
  value = await f.store.inspect(f.agentId, input.requestId);
  assert.equal(value.status, "processing");
  await assert.rejects(
    f.store.cancel(f.agentId, input.requestId),
    /cannot be canceled/,
  );
  assert.deepEqual(f.provider.events, []);
  await assert.rejects(
    f.store.record(
      f.agentId,
      input.requestId,
      "order-1",
      "javascript:alert(1)",
    ),
    /HTTPS/,
  );
  value = await f.store.record(
    f.agentId,
    input.requestId,
    "order-1",
    "https://bookshop.example/orders/1",
  );
  assert.equal(value.status, "completed");
  assert.equal(value.orderReference, "order-1");
  assert.equal(value.approvalUrl, undefined);
  await assert.rejects(
    f.store.withCard(f.agentId, input.requestId, async () =>
      assert.fail("Completed purchase exposed card"),
    ),
    /closed/,
  );
});
