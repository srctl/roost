import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { Effect } from "effect";
import { defaultNotificationPreferences } from "../src/features/notifications/schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from "../src/server/notifications/preferences.server";
import {
  type Attention,
  attentionPayload,
  deliverAttention,
  readPushSettings,
  readRunAttention,
  removePushSubscription,
  runNotificationKind,
  savePushSubscription,
  validatePushEndpoint,
  validateSubscription,
} from "../src/server/notifications/push.server";

const run = Effect.runPromise;
const subscription = (
  endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
) => {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
};

test("push subscriptions accept browser providers and reject arbitrary destinations and invalid encryption keys", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://wns2-bn3p.notify.windows.com/token",
  ])
    assert.equal(validatePushEndpoint(endpoint), endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/token",
    "https://127.0.0.1/token",
    "https://[::1]/token",
    "https://internal.example/token",
    "https://fcm.googleapis.com.evil.example/token",
    "https://fcm.googleapis.com@evil.example/token",
    "https://someone:secret@fcm.googleapis.com/token",
    "https://fcm.googleapis.com:8443/token",
    "https://fcm.googleapis.com/token#fragment",
    "https://fcm.googleapis.com/",
    "not a URL",
  ])
    assert.throws(() => validatePushEndpoint(endpoint));
  const valid = subscription();
  assert.deepEqual(validateSubscription(valid), valid);
  assert.throws(() =>
    validateSubscription({
      ...valid,
      keys: { ...valid.keys, p256dh: Buffer.alloc(65).toString("base64url") },
    }),
  );
  assert.throws(() =>
    validateSubscription({ ...valid, keys: { ...valid.keys, auth: "bad" } }),
  );
});

test("notification identity persists privately; subscriptions are idempotent and stale devices are removed without losing working devices", async (t) => {
  const directory = mkdtempSync("/tmp/roost-push-");
  const oldContact = process.env.ROOST_PUSH_SUBJECT;
  t.after(() => {
    if (oldContact === undefined) delete process.env.ROOST_PUSH_SUBJECT;
    else process.env.ROOST_PUSH_SUBJECT = oldContact;
    rmSync(directory, { recursive: true, force: true });
  });
  delete process.env.ROOST_PUSH_SUBJECT;
  assert.deepEqual(await run(readPushSettings(undefined, directory)), {
    publicKey: null,
    configured: false,
    registered: false,
    preferences: defaultNotificationPreferences,
  });
  process.env.ROOST_PUSH_SUBJECT = "mailto:owner@example.com";
  const settings = await run(readPushSettings(undefined, directory));
  assert.ok(settings.publicKey);
  assert.equal(
    (await run(readPushSettings(undefined, directory))).publicKey,
    settings.publicKey,
  );
  assert.equal(statSync(join(directory, "notifications")).mode & 0o777, 0o700);
  assert.equal(
    statSync(join(directory, "notifications/vapid.json")).mode & 0o777,
    0o600,
  );
  assert.ok(!("privateKey" in settings));

  const first = subscription();
  const expired = subscription("https://web.push.apple.com/expired");
  const temporarilyUnavailable = subscription(
    "https://updates.push.services.mozilla.com/wpush/v2/temporary",
  );
  await assert.rejects(run(savePushSubscription(first, "old-key", directory)));
  for (const item of [first, first, expired, temporarilyUnavailable])
    await run(savePushSubscription(item, settings.publicKey!, directory));
  assert.equal(
    (await run(readPushSettings(first.endpoint, directory))).registered,
    true,
  );
  assert.equal(
    await run(
      withAgentStore(
        (db) =>
          db.prepare("SELECT count(*) AS count FROM push_subscriptions").get()
            ?.count,
        directory,
      ),
    ),
    3,
  );

  const messages: { body: string; url: string; tag: string; title: string }[] =
    [];
  const result = await deliverAttention(
    { agentId: randomUUID(), id: randomUUID(), kind: "approval" },
    {
      directory,
      send: async (target, payload, options) => {
        assert.equal(options?.TTL, 3600);
        assert.equal(options?.timeout, 5000);
        assert.equal(options?.urgency, "high");
        messages.push(JSON.parse(String(payload)));
        if (target.endpoint === expired.endpoint) throw { statusCode: 410 };
        if (target.endpoint === temporarilyUnavailable.endpoint)
          throw { statusCode: 503, body: "private upstream response" };
        return { statusCode: 201, headers: {}, body: "" };
      },
    },
  );
  assert.deepEqual(result, { delivered: 1, expired: 1, failed: 1 });
  assert.equal(messages.length, 3);
  assert.deepEqual(Object.keys(messages[0]!).sort(), [
    "body",
    "tag",
    "title",
    "url",
  ]);
  assert.equal(
    messages[0]!.body,
    "Open the conversation to review the request.",
  );
  assert.equal(
    (await run(readPushSettings(expired.endpoint, directory))).registered,
    false,
  );
  assert.equal(
    (await run(readPushSettings(temporarilyUnavailable.endpoint, directory)))
      .registered,
    true,
  );
  await run(removePushSubscription(first.endpoint, directory));
  assert.equal(
    (await run(readPushSettings(first.endpoint, directory))).registered,
    false,
  );
  assert.equal(
    (await run(readPushSettings(temporarilyUnavailable.endpoint, directory)))
      .registered,
    true,
  );

  await run(
    withAgentStore(
      (db) =>
        db
          .prepare("UPDATE push_subscriptions SET subscription=?")
          .run(JSON.stringify(subscription("https://127.0.0.1/private"))),
      directory,
    ),
  );
  const invalid = await deliverAttention(
    { agentId: randomUUID(), id: randomUUID(), kind: "completed" },
    {
      directory,
      send: async () => {
        assert.fail("Persisted endpoints must be validated before delivery.");
      },
    },
  );
  assert.deepEqual(invalid, { delivered: 0, expired: 0, failed: 1 });
});

test("run notifications honor quiet automations, cancellations, and delegated work", () => {
  const complete = {
    kind: "chat",
    status: "completed",
    automationSnapshot: null,
    messages: "[]",
  };
  assert.equal(runNotificationKind(complete), "completed");
  assert.equal(
    runNotificationKind({ ...complete, status: "failed" }),
    "failed",
  );
  assert.equal(
    runNotificationKind({ ...complete, status: "interrupted" }),
    "failed",
  );
  for (const status of ["cancelled", "queued", "running"])
    assert.equal(runNotificationKind({ ...complete, status }), null);
  assert.equal(runNotificationKind({ ...complete, kind: "delegation" }), null);
  const quiet = {
    ...complete,
    kind: "automation",
    automationSnapshot: JSON.stringify({ notification: "when-needed" }),
    messages: JSON.stringify([
      { role: "assistant", text: " ROOST_NO_UPDATE \n" },
    ]),
  };
  assert.equal(runNotificationKind(quiet), null);
  assert.equal(runNotificationKind({ ...quiet, status: "failed" }), "failed");
  assert.equal(
    runNotificationKind({
      ...quiet,
      messages: JSON.stringify([
        { role: "assistant", text: "Needs attention" },
      ]),
    }),
    "completed",
  );
  assert.equal(
    runNotificationKind({
      ...quiet,
      automationSnapshot: JSON.stringify({ notification: "always" }),
    }),
    "completed",
  );
  const payload = attentionPayload({
    agentId: "../outside",
    id: "request",
    kind: "failed",
  });
  assert.equal(payload.url, "/agents/..%2Foutside");
  assert.equal(
    payload.body,
    "The turn could not finish. Open the conversation for details.",
  );
});

test("notification categories gate delivery across devices and survive switching all notifications off and on", async (t) => {
  const directory = mkdtempSync("/tmp/roost-push-preferences-");
  const oldContact = process.env.ROOST_PUSH_SUBJECT;
  process.env.ROOST_PUSH_SUBJECT = "mailto:owner@example.com";
  t.after(() => {
    if (oldContact === undefined) delete process.env.ROOST_PUSH_SUBJECT;
    else process.env.ROOST_PUSH_SUBJECT = oldContact;
    rmSync(directory, { recursive: true, force: true });
  });
  const settings = await run(readPushSettings(undefined, directory));
  for (let i = 0; i < 2; i++)
    await run(
      savePushSubscription(subscription(), settings.publicKey!, directory),
    );
  const kinds: Attention["kind"][] = [
    "completed",
    "agent",
    "approval",
    "failed",
  ];
  const checkDelivery = async (expected: Attention["kind"][]) => {
    const sent: string[] = [];
    for (const kind of kinds)
      await deliverAttention(
        { agentId: randomUUID(), id: randomUUID(), kind },
        {
          directory,
          send: async () => {
            sent.push(kind);
            return { statusCode: 201, headers: {}, body: "" };
          },
        },
      );
    assert.deepEqual(
      sent,
      expected.flatMap((kind) => [kind, kind]),
    );
  };
  await checkDelivery(kinds);
  await run(setNotificationPreferences({ enabled: false }, directory));
  await checkDelivery([]);
  await run(setNotificationPreferences({ enabled: true }, directory));
  await run(setNotificationPreferences({ turnCompleted: false }, directory));
  await checkDelivery(["agent", "approval", "failed"]);
  await run(setNotificationPreferences({ agentUpdates: false }, directory));
  await checkDelivery(["approval", "failed"]);
  await run(setNotificationPreferences({ needsAttention: false }, directory));
  await checkDelivery([]);
  await run(
    setNotificationPreferences(
      { agentUpdates: true, enabled: false },
      directory,
    ),
  );
  await checkDelivery([]);
  await run(setNotificationPreferences({ enabled: true }, directory));
  assert.deepEqual(await run(getNotificationPreferences(directory)), {
    enabled: true,
    turnCompleted: false,
    agentUpdates: true,
    needsAttention: false,
  });
  assert.equal(
    (await run(readPushSettings(undefined, directory))).preferences
      .turnCompleted,
    false,
  );
  await checkDelivery(["agent"]);
});

test("notifications name the agent and carry the final result, failure, approval, or explicit update without duplicate completion", async (t) => {
  const directory = mkdtempSync("/tmp/roost-push-content-");
  const oldContact = process.env.ROOST_PUSH_SUBJECT;
  process.env.ROOST_PUSH_SUBJECT = "mailto:owner@example.com";
  t.after(() => {
    if (oldContact === undefined) delete process.env.ROOST_PUSH_SUBJECT;
    else process.env.ROOST_PUSH_SUBJECT = oldContact;
    rmSync(directory, { recursive: true, force: true });
  });
  const agent = await run(
    saveAgent(
      {
        id: randomUUID(),
        name: "Shoppy",
        instructions: "Track packages",
        character: "moss",
        model: "fake",
      },
      directory,
    ),
  );
  const settings = await run(readPushSettings(undefined, directory));
  await run(
    savePushSubscription(subscription(), settings.publicKey!, directory),
  );
  const runId = randomUUID();
  const approvalId = randomUUID();
  await run(
    withAgentStore((db) => {
      db.prepare(
        "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt,messages) VALUES (?,?,?,?,?,?,?)",
      ).run(
        runId,
        agent.id,
        "chat",
        "Check my package",
        "completed",
        Date.now(),
        JSON.stringify([
          { role: "assistant", text: "I will check the order." },
          {
            role: "assistant",
            text: "## Delivery update\n**Your package arrived.** [Tracking](https://example.com/track) says it is at the front door.\nROOST_NO_UPDATE",
          },
          { role: "activity", text: "Tool finished" },
        ]),
      );
      db.prepare(
        "INSERT INTO approvals(id,agentId,runId,threadId,requestKey,request,createdAt) VALUES (?,?,?,?,?,?,?)",
      ).run(
        approvalId,
        agent.id,
        runId,
        "thread",
        "request",
        JSON.stringify({
          title: "Approve replacement order",
          details:
            "The original item is out of stock. Order the **blue** one for $24?",
        }),
        Date.now(),
      );
    }, directory),
  );
  const payloads: ReturnType<typeof attentionPayload>[] = [];
  const send = async (attention: Attention) => {
    await deliverAttention(attention, {
      directory,
      send: async (_target, payload) => {
        payloads.push(JSON.parse(String(payload)));
        return { statusCode: 201, headers: {}, body: "" };
      },
    });
    return payloads.at(-1)!;
  };
  const completed = await run(readRunAttention(runId, directory));
  assert.ok(completed);
  const result = await send(completed);
  assert.equal(result.title, "Shoppy · Turn complete");
  assert.equal(
    result.body,
    "Delivery update Your package arrived. Tracking says it is at the front door.",
  );
  await run(
    withAgentStore((db) => {
      db.prepare("UPDATE runs SET messages=? WHERE id=?").run(
        JSON.stringify([
          { role: "assistant", text: "The result is `2*3*4` hours." },
        ]),
        runId,
      );
    }, directory),
  );
  const arithmetic = await run(readRunAttention(runId, directory));
  assert.ok(arithmetic);
  assert.equal((await send(arithmetic)).body, "The result is 2*3*4 hours.");
  const approval = await send({
    agentId: agent.id,
    id: approvalId,
    kind: "approval",
  });
  assert.equal(approval.title, "Shoppy · Approve replacement order");
  assert.equal(
    approval.body,
    "The original item is out of stock. Order the blue one for $24?",
  );
  const explicit = await send({
    agentId: agent.id,
    id: "update",
    kind: "agent",
    title: "Package delivered",
    body: "Your headphones arrived at the front door at 2:14 PM.",
  });
  assert.equal(explicit.title, "Shoppy · Package delivered");
  assert.equal(explicit.url, `/agents/${agent.id}`);
  assert.equal(
    explicit.body,
    "Your headphones arrived at the front door at 2:14 PM.",
  );
  await run(
    withAgentStore((db) => {
      db.prepare(
        "INSERT INTO agent_notifications(id,agentId,runId,requestId,title,body,createdAt) VALUES (?,?,?,?,?,?,?)",
      ).run(
        "update",
        agent.id,
        runId,
        "request",
        "Package delivered",
        explicit.body,
        Date.now(),
      );
      db.prepare("UPDATE runs SET hasAgentUpdate=1 WHERE id=?").run(runId);
    }, directory),
  );
  assert.equal(await run(readRunAttention(runId, directory)), null);
  await run(setNotificationPreferences({ agentUpdates: false }, directory));
  assert.equal(
    (await run(readRunAttention(runId, directory)))?.kind,
    "completed",
  );
  await run(setNotificationPreferences({ agentUpdates: true }, directory));
  await run(
    withAgentStore((db) => {
      db.prepare("UPDATE runs SET status='failed',error=? WHERE id=?").run(
        "The store rejected the order because the item is out of stock.",
        runId,
      );
    }, directory),
  );
  const failure = await run(readRunAttention(runId, directory));
  assert.ok(failure);
  const failed = await send(failure);
  assert.equal(failed.title, "Shoppy · Needs attention");
  assert.equal(
    failed.body,
    "The store rejected the order because the item is out of stock.",
  );
  const bounded = attentionPayload(
    {
      agentId: agent.id,
      id: "long",
      kind: "agent",
      title: "Delivery ".repeat(30),
      body: "**Package** ".repeat(80),
    },
    agent.name,
  );
  assert.ok(bounded.title.length <= 100 && bounded.title.endsWith("…"));
  assert.ok(bounded.body.length <= 240 && bounded.body.endsWith("…"));
  assert.ok(!bounded.body.includes("**"));
  assert.equal(await run(readRunAttention(randomUUID(), directory)), null);
});

test("service worker displays push notifications and clicks stay within Roost", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: { body?: string } }[] = [];
  const opened: string[] = [];
  let focused = false;
  let windows: { url: string; focus: () => Promise<void> }[] = [];
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    {
      URL,
      self: {
        location: { origin: "https://roost.example" },
        addEventListener: (name: string, handler: (event: unknown) => void) =>
          listeners.set(name, handler),
        registration: {
          showNotification: async (
            title: string,
            options: { body?: string },
          ) => {
            shown.push({ title, options });
          },
        },
        clients: {
          matchAll: async () => windows,
          openWindow: async (url: string) => {
            opened.push(url);
          },
        },
      },
    },
  );
  let pending: Promise<unknown> | undefined;
  const waitUntil = (promise: Promise<unknown>) => {
    pending = promise;
  };
  listeners.get("push")!({
    data: {
      json: () => ({
        title: "Shoppy · Package delivered",
        body: "Your package is at the front door.",
        url: "/",
      }),
    },
    waitUntil,
  });
  await pending;
  assert.equal(shown[0].title, "Shoppy · Package delivered");
  assert.equal(shown[0].options.body, "Your package is at the front door.");
  listeners.get("push")!({
    data: {
      json: () => {
        throw new Error("malformed");
      },
    },
    waitUntil,
  });
  await pending;
  assert.equal(shown[1].title, "Roost");
  assert.equal(shown[1].options.body, "An agent has an update for you.");
  listeners.get("push")!({
    data: { json: () => ({ title: "x".repeat(150), body: "y".repeat(300) }) },
    waitUntil,
  });
  await pending;
  assert.equal(shown[2].title.length, 100);
  assert.equal(shown[2].options.body?.length, 240);
  const id = randomUUID();
  const url = `https://roost.example/agents/${id}`;
  const click = async (target: unknown) => {
    listeners.get("notificationclick")!({
      notification: { close() {}, data: { url: target } },
      waitUntil,
    });
    await pending;
  };
  await click(`/agents/${id}`);
  assert.equal(opened.at(-1), url);
  windows = [
    {
      url,
      focus: async () => {
        focused = true;
      },
    },
  ];
  await click(`/agents/${id}`);
  assert.equal(focused, true);
  assert.equal(opened.length, 1);
  for (const target of [
    `https://evil.example/agents/${id}`,
    "//evil.example",
    "javascript:alert(1)",
    "/settings",
    `/agents/${id}?redirect=elsewhere`,
  ]) {
    await click(target);
    assert.equal(opened.at(-1), "https://roost.example/");
  }
});
