import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { Effect } from "effect";
import { withAgentStore } from "../src/server/agents/store.server";
import {
  attentionPayload,
  deliverAttention,
  readPushSettings,
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
  assert.equal(messages[0]!.body, "An agent needs your approval.");
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
  assert.equal(payload.body, "An agent’s run needs attention.");
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
    data: { json: () => ({ body: "An agent needs your approval.", url: "/" }) },
    waitUntil,
  });
  await pending;
  assert.equal(shown[0].title, "Roost");
  assert.equal(shown[0].options.body, "An agent needs your approval.");
  listeners.get("push")!({
    data: {
      json: () => {
        throw new Error("malformed");
      },
    },
    waitUntil,
  });
  await pending;
  assert.equal(shown[1].options.body, "An agent has an update for you.");
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
