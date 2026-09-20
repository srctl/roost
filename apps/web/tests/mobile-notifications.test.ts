import assert from "node:assert/strict";
import {
  createECDH,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { Effect } from "effect";
import { mobileNotificationsRequest } from "../src/server/mobile/notifications.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import {
  type APNsRequest,
  apnsProviderToken,
  deliverNativeAttention,
  readAPNsConfig,
  sendAPNs,
} from "../src/server/notifications/apns.server";
import { setNotificationPreferences } from "../src/server/notifications/preferences.server";
import {
  attentionPayload,
  deliverAttention,
  readPushSettings,
  savePushSubscription,
} from "../src/server/notifications/push.server";

function fixture(t: TestContext) {
  const directory = mkdtempSync("/tmp/roost-apns-test-");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const key = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  }).privateKey;
  const path = join(directory, "fixture-key.p8");
  writeFileSync(path, key.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  const env = {
    ROOST_APNS_TEAM_ID: "TEAM123456",
    ROOST_APNS_KEY_ID: "KEY1234567",
    ROOST_APNS_BUNDLE_ID: "dev.roost.iphone",
    ROOST_APNS_ENVIRONMENT: "sandbox",
    ROOST_APNS_PRIVATE_KEY_PATH: path,
  };
  const store = new MobileTokens(directory);
  t.after(() => store.close());
  const device = store.create("Fixture iPhone");
  const other = store.create("Other fixture iPhone");
  const input = {
    deviceToken: "ab".repeat(32),
    bundleId: env.ROOST_APNS_BUNDLE_ID,
    environment: "sandbox",
  };
  const register = (deviceId = device.id, token = input.deviceToken) =>
    store.registerPush(deviceId, {
      token,
      topic: input.bundleId,
      environment: "sandbox",
    });
  const attention = {
    agentId: randomUUID(),
    conversationId: randomUUID(),
    id: randomUUID(),
    kind: "approval" as const,
    body: "Please review the plan.",
  };
  const call = (
    method: string,
    data?: unknown,
    identity = device.id,
    config = env,
  ) =>
    mobileNotificationsRequest(
      "notifications/push",
      new Request("https://fixture.example/api/mobile/v1/notifications/push", {
        method,
        ...(data !== undefined
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            }
          : {}),
      }),
      (request) => request.json(),
      identity,
      { directory, env: config },
    );
  return {
    directory,
    key,
    env,
    store,
    device,
    other,
    input,
    register,
    attention,
    call,
  };
}

test("APNs configuration requires explicit valid identifiers, environment, and a bounded P-256 private key", (t) => {
  const f = fixture(t);
  assert.equal(readAPNsConfig({}), null);
  assert.ok(readAPNsConfig(f.env));
  for (const patch of [
    { ROOST_APNS_TEAM_ID: "bad" },
    { ROOST_APNS_KEY_ID: "bad\nheader" },
    { ROOST_APNS_ENVIRONMENT: "https://untrusted.example" },
    { ROOST_APNS_BUNDLE_ID: "dev.roost.*" },
    { ROOST_APNS_PRIVATE_KEY_PATH: "relative.p8" },
    { ROOST_APNS_PRIVATE_KEY_PATH: join(f.directory, "missing") },
  ])
    assert.equal(readAPNsConfig({ ...f.env, ...patch }), null);
  const invalid = join(f.directory, "invalid.p8");
  writeFileSync(invalid, "not a private key");
  assert.equal(
    readAPNsConfig({ ...f.env, ROOST_APNS_PRIVATE_KEY_PATH: invalid }),
    null,
  );
  writeFileSync(invalid, "a".repeat(16_385));
  assert.equal(
    readAPNsConfig({ ...f.env, ROOST_APNS_PRIVATE_KEY_PATH: invalid }),
    null,
  );
  writeFileSync(
    invalid,
    generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
  );
  assert.equal(
    readAPNsConfig({ ...f.env, ROOST_APNS_PRIVATE_KEY_PATH: invalid }),
    null,
  );
});

test("APNs provider JWT has a valid ES256 signature and refreshes after 50 minutes", (t) => {
  const f = fixture(t);
  const config = readAPNsConfig(f.env)!;
  const now = 1_800_000_000_000;
  const token = apnsProviderToken(config, now);
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "ES256",
    kid: f.env.ROOST_APNS_KEY_ID,
  });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), {
    iss: f.env.ROOST_APNS_TEAM_ID,
    iat: now / 1000,
  });
  assert.equal(Buffer.from(signature, "base64url").length, 64);
  assert.equal(
    verify(
      "sha256",
      Buffer.from(`${header}.${payload}`),
      { key: createPublicKey(f.key), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
    true,
  );
  assert.equal(apnsProviderToken(config, now + 49 * 60_000), token);
  assert.notEqual(apnsProviderToken(config, now + 50 * 60_000), token);
});

test("native push registration exposes readiness without secrets and validates the signed app environment", async (t) => {
  const f = fixture(t);
  const disabled = await f.call(
    "GET",
    undefined,
    f.device.id,
    {} as typeof f.env,
  );
  assert.deepEqual(disabled?.value, {
    configured: false,
    registered: false,
    environment: null,
    bundleId: null,
    registrationId: null,
  });
  assert.equal(
    (await f.call("POST", f.input, f.device.id, {} as typeof f.env))?.status,
    409,
  );
  assert.equal(
    (await f.call("POST", { ...f.input, environment: "production" }))?.status,
    409,
  );
  assert.equal(
    (await f.call("POST", { ...f.input, bundleId: "dev.other.app" }))?.status,
    409,
  );
  for (const deviceToken of [
    "odd",
    "f",
    "https://untrusted.example",
    "a".repeat(514),
  ])
    assert.equal(
      (await f.call("POST", { ...f.input, deviceToken }))?.status,
      400,
    );
  assert.equal(
    (await f.call("POST", { ...f.input, deviceId: f.other.id }))?.status,
    400,
  );
  const registered = await f.call("POST", {
    ...f.input,
    deviceToken: f.input.deviceToken.toUpperCase(),
  });
  const status = registered?.value as {
    registered: boolean;
    registrationId: string;
  };
  assert.equal(status.registered, true);
  assert.ok(status.registrationId);
  assert.equal(JSON.stringify(registered).includes(f.input.deviceToken), false);
  assert.equal(
    JSON.stringify(registered).includes(f.env.ROOST_APNS_PRIVATE_KEY_PATH),
    false,
  );
  assert.equal(
    f.store.pushRegistration(f.device.id)?.token,
    f.input.deviceToken,
  );
  assert.equal((await f.call("PUT"))?.status, 405);
  assert.equal(
    statSync(join(f.directory, "mobile.sqlite")).mode & 0o777,
    0o600,
  );
});

test("push bindings survive idempotent registration, rotate on token change, transfer safely, and cascade on revocation", async (t) => {
  const f = fixture(t);
  const first = f.register();
  assert.equal(f.register().registrationId, first.registrationId);
  const rotated = f.register(f.device.id, "cd".repeat(32));
  assert.notEqual(rotated.registrationId, first.registrationId);
  await f.call("DELETE", undefined, f.other.id);
  assert.equal(
    f.store.pushRegistration(f.device.id)?.registrationId,
    rotated.registrationId,
  );
  const transferred = f.register(f.other.id, "cd".repeat(32));
  assert.notEqual(transferred.registrationId, rotated.registrationId);
  assert.equal(f.store.pushRegistration(f.device.id), null);
  await f.call("DELETE");
  assert.equal(
    f.store.pushRegistration(f.other.id)?.registrationId,
    transferred.registrationId,
  );
  f.store.revoke(f.other.id);
  assert.deepEqual(f.store.pushTargets(), []);
  const db = new DatabaseSync(join(f.directory, "mobile.sqlite"));
  try {
    assert.equal(
      db
        .prepare("SELECT count(*) AS count FROM mobile_push_registrations")
        .get()?.count,
      0,
    );
  } finally {
    db.close();
  }
  assert.equal((await f.call("GET", undefined, f.other.id))?.status, 401);
});

test("native delivery carries safe routing identity and bounded Apple headers through mocked transport", async (t) => {
  const f = fixture(t);
  const registration = f.register();
  const requests: APNsRequest[] = [];
  const result = await deliverNativeAttention(
    f.attention,
    attentionPayload(f.attention, "Moss"),
    {
      directory: f.directory,
      env: f.env,
      transport: async (request) => {
        requests.push(request);
        return { status: 200 };
      },
    },
  );
  assert.deepEqual(result, { delivered: 1, expired: 0, failed: 0 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].environment, "sandbox");
  assert.equal(requests[0].deviceToken, f.input.deviceToken);
  assert.equal(requests[0].headers["apns-topic"], "dev.roost.iphone");
  assert.equal(requests[0].headers["apns-push-type"], "alert");
  assert.equal(requests[0].headers["apns-priority"], "10");
  assert.match(
    requests[0].headers.authorization,
    /^bearer [^.]+\.[^.]+\.[^.]+$/,
  );
  assert.equal(Buffer.byteLength(requests[0].headers["apns-collapse-id"]), 64);
  assert.ok(Buffer.byteLength(requests[0].body) < 4096);
  const payload = JSON.parse(requests[0].body);
  assert.equal(payload.registrationId, registration.registrationId);
  assert.equal(payload.agentId, f.attention.agentId);
  assert.equal(payload.conversationId, f.attention.conversationId);
  assert.equal(payload.notificationId, f.attention.id);
  assert.equal(payload.aps.alert.title, "Moss · Approval needed");
  assert.equal(payload.aps.sound, "default");
  assert.equal(requests[0].body.includes(f.device.secret), false);
});

test("APNs removes invalid registrations but preserves retryable failures and other devices", async (t) => {
  const f = fixture(t);
  const first = f.register();
  const second = f.register(f.other.id, "cd".repeat(32));
  const result = await deliverNativeAttention(
    f.attention,
    attentionPayload(f.attention),
    {
      directory: f.directory,
      env: f.env,
      transport: async (request) =>
        request.deviceToken === first.token
          ? {
              status: 410,
              reason: "Unregistered",
              timestamp: first.updatedAt + 1,
            }
          : { status: 503, reason: "ServiceUnavailable" },
    },
  );
  assert.deepEqual(result, { delivered: 0, expired: 1, failed: 1 });
  assert.equal(f.store.pushRegistration(f.device.id), null);
  assert.equal(
    f.store.pushRegistration(f.other.id)?.registrationId,
    second.registrationId,
  );
  const badToken = await deliverNativeAttention(
    f.attention,
    attentionPayload(f.attention),
    {
      directory: f.directory,
      env: f.env,
      transport: async () => ({ status: 400, reason: "BadDeviceToken" }),
    },
  );
  assert.equal(badToken.expired, 1);
  assert.deepEqual(f.store.pushTargets(), []);
});

test("an old APNs invalidation cannot remove a re-registered token or a newer registration", async (t) => {
  const f = fixture(t);
  const old = f.register();
  await deliverNativeAttention(f.attention, attentionPayload(f.attention), {
    directory: f.directory,
    env: f.env,
    transport: async () => ({
      status: 410,
      reason: "Unregistered",
      timestamp: old.updatedAt - 1,
    }),
  });
  assert.ok(f.store.pushRegistration(f.device.id));
  await deliverNativeAttention(f.attention, attentionPayload(f.attention), {
    directory: f.directory,
    env: f.env,
    transport: async () => {
      f.register();
      return {
        status: 410,
        reason: "Unregistered",
        timestamp: Date.now() + 10_000,
      };
    },
  });
  assert.ok(f.store.pushRegistration(f.device.id));
});

test("native dispatch honors global/category preferences and remains independent of web push readiness", async (t) => {
  const f = fixture(t);
  f.register();
  let sent = 0;
  const options = {
    directory: f.directory,
    apns: {
      env: f.env,
      transport: async () => {
        sent++;
        return { status: 200 };
      },
    },
  };
  assert.equal((await deliverAttention(f.attention, options)).delivered, 1);
  await Effect.runPromise(
    setNotificationPreferences({ enabled: false }, f.directory),
  );
  assert.deepEqual(await deliverAttention(f.attention, options), {
    delivered: 0,
    expired: 0,
    failed: 0,
  });
  await Effect.runPromise(
    setNotificationPreferences(
      { enabled: true, needsAttention: false },
      f.directory,
    ),
  );
  assert.equal((await deliverAttention(f.attention, options)).delivered, 0);
  assert.equal(sent, 1);
  assert.equal(
    (await deliverAttention({ ...f.attention, kind: "agent" }, options))
      .delivered,
    1,
  );
});

test("an APNs provider failure does not prevent existing web push delivery", async (t) => {
  const f = fixture(t);
  f.register();
  const previous = process.env.ROOST_PUSH_SUBJECT;
  process.env.ROOST_PUSH_SUBJECT = "mailto:fixture@example.com";
  t.after(() => {
    if (previous === undefined) delete process.env.ROOST_PUSH_SUBJECT;
    else process.env.ROOST_PUSH_SUBJECT = previous;
  });
  const settings = await Effect.runPromise(
    readPushSettings(undefined, f.directory),
  );
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  await Effect.runPromise(
    savePushSubscription(
      {
        endpoint: "https://web.push.apple.com/fixture",
        keys: {
          p256dh: ec.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
      },
      settings.publicKey!,
      f.directory,
    ),
  );
  let webSent = 0;
  const result = await deliverAttention(f.attention, {
    directory: f.directory,
    send: async () => {
      webSent++;
      return { statusCode: 201, body: "", headers: {} };
    },
    apns: {
      env: f.env,
      transport: async () => {
        throw new Error("private upstream detail");
      },
    },
  });
  assert.equal(webSent, 1);
  assert.deepEqual(result, { delivered: 1, expired: 0, failed: 1 });
});

test("unconfigured or expired native devices do not contact a provider, and destinations are fixed", async (t) => {
  const f = fixture(t);
  f.register();
  let sent = 0;
  const options = {
    directory: f.directory,
    env: {},
    transport: async () => {
      sent++;
      return { status: 200 };
    },
  };
  assert.equal(
    (
      await deliverNativeAttention(
        f.attention,
        attentionPayload(f.attention),
        options,
      )
    ).delivered,
    0,
  );
  const db = new DatabaseSync(join(f.directory, "mobile.sqlite"));
  try {
    db.prepare("UPDATE devices SET expires=0 WHERE id=?").run(f.device.id);
  } finally {
    db.close();
  }
  assert.equal(
    (
      await deliverNativeAttention(f.attention, attentionPayload(f.attention), {
        ...options,
        env: f.env,
      })
    ).delivered,
    0,
  );
  assert.equal(sent, 0);
  await assert.rejects(
    sendAPNs({
      environment: "https://untrusted.example" as "sandbox",
      identity: "fixture",
      deviceToken: f.input.deviceToken,
      headers: {},
      body: "{}",
    }),
    /APNs is unavailable/,
  );
});

test("corrupt browser VAPID configuration cannot suppress configured native push", async (t) => {
  const f = fixture(t);
  f.register();
  const previous = process.env.ROOST_PUSH_SUBJECT;
  process.env.ROOST_PUSH_SUBJECT = "mailto:fixture@example.com";
  t.after(() => {
    if (previous === undefined) delete process.env.ROOST_PUSH_SUBJECT;
    else process.env.ROOST_PUSH_SUBJECT = previous;
  });
  const settings = await Effect.runPromise(
    readPushSettings(undefined, f.directory),
  );
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  await Effect.runPromise(
    savePushSubscription(
      {
        endpoint: "https://web.push.apple.com/fixture",
        keys: {
          p256dh: ec.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
      },
      settings.publicKey!,
      f.directory,
    ),
  );
  writeFileSync(
    join(f.directory, "notifications", "vapid.json"),
    "invalid fixture configuration",
  );
  const result = await deliverAttention(f.attention, {
    directory: f.directory,
    send: async () => {
      throw new Error("web transport must not run without valid keys");
    },
    apns: { env: f.env, transport: async () => ({ status: 200 }) },
  });
  assert.deepEqual(result, { delivered: 1, expired: 0, failed: 1 });
});
