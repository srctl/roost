import assert from "node:assert/strict";
import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { type TestContext, test } from "node:test";
import { Effect } from "effect";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { handleAgentTool } from "../src/server/codex/agent-tools.server";
import { setNotificationPreferences } from "../src/server/notifications/preferences.server";
import {
  readPushSettings,
  readRunAttention,
  savePushSubscription,
} from "../src/server/notifications/push.server";
import { notifyAgent } from "../src/server/notifications/tools.server";

const run = Effect.runPromise;
const update = () => ({
  requestId: randomUUID(),
  title: "Your headphones were delivered",
  body: "The carrier reports delivery at 2:14 PM, beside your front door.",
});

async function fixture(t: TestContext) {
  const directory = mkdtempSync("/tmp/roost-agent-notifications-");
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
        instructions: "Track the user's deliveries.",
        character: "moss",
        model: "fake",
      },
      directory,
    ),
  );
  const runId = randomUUID();
  const db = <A>(read: Parameters<typeof withAgentStore<A>>[0]) =>
    run(withAgentStore(read, directory));
  await db((store) =>
    store
      .prepare(
        "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES (?,?,'automation','Check delivery','running',?)",
      )
      .run(runId, agent.id, Date.now()),
  );
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  const settings = await run(readPushSettings(undefined, directory));
  await run(
    savePushSubscription(
      {
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
        keys: {
          p256dh: keys.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
      },
      settings.publicKey!,
      directory,
    ),
  );
  return { directory, agentId: agent.id, runId, db };
}

test("agent updates preserve useful conversation content and concurrent retries submit only once", async (t) => {
  const { directory, agentId, runId, db } = await fixture(t);
  const input = update();
  const payloads: { title: string; body: string; url: string }[] = [];
  const options = {
    directory,
    send: async (_subscription: unknown, payload: unknown) => {
      payloads.push(JSON.parse(String(payload)));
      return { statusCode: 201, headers: {}, body: "" };
    },
  };
  const responses = await Promise.all([
    run(notifyAgent(agentId, runId, input, options)),
    run(notifyAgent(agentId, runId, input, options)),
  ]);
  assert.equal(payloads.length, 1);
  assert.deepEqual(responses.map((result) => result.duplicate).sort(), [
    false,
    true,
  ]);
  assert.equal(responses[0].id, responses[1].id);
  assert.equal(
    responses.find((result) => !result.duplicate)?.delivery.status,
    "submitted",
  );
  assert.match(payloads[0].title, /Shoppy/);
  assert.equal(payloads[0].body, input.body);
  assert.equal(payloads[0].url, `/agents/${agentId}`);
  const notice = await db((store) =>
    store
      .prepare("SELECT message FROM timeline WHERE id=?")
      .get(`notification:${responses[0].id}`),
  );
  assert.deepEqual(JSON.parse(String(notice?.message)), {
    id: `notification:${responses[0].id}`,
    role: "notice",
    title: input.title,
    text: input.body,
  });
  await assert.rejects(
    run(notifyAgent(agentId, runId, { ...input, body: "Changed" }, options)),
    /different notification/,
  );
  assert.equal(payloads.length, 1);
  assert.equal(
    await db(
      (store) =>
        store.prepare("SELECT count(*) AS count FROM agent_notifications").get()
          ?.count,
    ),
    1,
  );
});

test("updates require the active agent's uncancelled run and cannot bypass delegation routing", async (t) => {
  const { directory, agentId, runId, db } = await fixture(t);
  const other = await run(
    saveAgent(
      {
        id: randomUUID(),
        name: "Other",
        instructions: "Help",
        character: "moss",
        model: "fake",
      },
      directory,
    ),
  );
  let submissions = 0;
  const options = {
    directory,
    send: async () => {
      submissions++;
      return { statusCode: 201, headers: {}, body: "" };
    },
  };
  for (const id of [undefined, randomUUID()])
    await assert.rejects(
      run(notifyAgent(agentId, id, update(), options)),
      /active/,
    );
  await assert.rejects(
    run(notifyAgent(other.id, runId, update(), options)),
    /active/,
  );
  for (const status of [
    "queued",
    "completed",
    "failed",
    "interrupted",
    "cancelled",
  ]) {
    await db((store) =>
      store.prepare("UPDATE runs SET status=? WHERE id=?").run(status, runId),
    );
    await assert.rejects(
      run(notifyAgent(agentId, runId, update(), options)),
      /active/,
    );
  }
  await db((store) =>
    store
      .prepare("UPDATE runs SET status='running',cancelRequested=1 WHERE id=?")
      .run(runId),
  );
  await assert.rejects(
    run(notifyAgent(agentId, runId, update(), options)),
    /active/,
  );
  await db((store) =>
    store
      .prepare("UPDATE runs SET kind='delegation',cancelRequested=0 WHERE id=?")
      .run(runId),
  );
  await assert.rejects(
    run(notifyAgent(agentId, runId, update(), options)),
    /originating agent/,
  );
  assert.equal(submissions, 0);
  assert.equal(
    await db(
      (store) =>
        store.prepare("SELECT count(*) AS count FROM agent_notifications").get()
          ?.count,
    ),
    0,
  );
});

test("retrying an update in a later run sends neither the event nor a completion notification", async (t) => {
  const { directory, agentId, runId, db } = await fixture(t);
  const input = update();
  let submissions = 0;
  const options = {
    directory,
    send: async () => {
      submissions++;
      return { statusCode: 201, headers: {}, body: "" };
    },
  };
  const first = await run(notifyAgent(agentId, runId, input, options));
  await db((store) =>
    store.prepare("UPDATE runs SET status='completed' WHERE id=?").run(runId),
  );
  const nextRun = randomUUID();
  await db((store) =>
    store
      .prepare(
        "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES (?,?,'automation','Check delivery','running',?)",
      )
      .run(nextRun, agentId, Date.now()),
  );
  await assert.rejects(
    run(notifyAgent(agentId, nextRun, { ...input, body: "Changed" }, options)),
    /different notification/,
  );
  assert.equal(
    await db(
      (store) =>
        store.prepare("SELECT hasAgentUpdate FROM runs WHERE id=?").get(nextRun)
          ?.hasAgentUpdate,
    ),
    0,
  );
  const retry = await run(notifyAgent(agentId, nextRun, input, options));
  assert.equal(retry.id, first.id);
  assert.equal(retry.duplicate, true);
  assert.equal(submissions, 1);
  await db((store) =>
    store.prepare("UPDATE runs SET status='completed' WHERE id=?").run(nextRun),
  );
  assert.equal(await run(readRunAttention(nextRun, directory)), null);
});

test("muting all notifications or agent updates preserves the notice without submitting a push", async (t) => {
  const { directory, agentId, runId, db } = await fixture(t);
  let submissions = 0;
  for (const preferences of [
    { enabled: false, agentUpdates: true },
    { enabled: true, agentUpdates: false },
  ]) {
    await run(setNotificationPreferences(preferences, directory));
    const result = await run(
      notifyAgent(agentId, runId, update(), {
        directory,
        send: async () => {
          submissions++;
          return { statusCode: 201, headers: {}, body: "" };
        },
      }),
    );
    assert.equal(result.recorded, true);
    assert.equal(result.delivery.status, "not-submitted");
  }
  assert.equal(submissions, 0);
  assert.equal(
    await db(
      (store) =>
        store.prepare("SELECT count(*) AS count FROM timeline").get()?.count,
    ),
    2,
  );
});

test("background runs can use the notification tool and blank or oversized messages are rejected", async (t) => {
  const { directory, agentId, runId } = await fixture(t);
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
  });
  await run(setNotificationPreferences({ enabled: false }, directory));
  const context = { agentId, runId, allowMutations: false };
  const response = await handleAgentTool(context, "roost_notify", update());
  assert.equal(response.success, true);
  assert.equal(response.contentItems[0].type, "inputText");
  if (response.contentItems[0].type === "inputText") {
    const value = JSON.parse(response.contentItems[0].text);
    assert.equal(value.recorded, true);
    assert.equal(value.delivery.status, "not-submitted");
  }
  for (const invalid of [
    { title: "  " },
    { body: "\n" },
    { title: "x".repeat(101) },
    { body: "x".repeat(241) },
    { requestId: "unstable" },
  ])
    assert.equal(
      (
        await handleAgentTool(context, "roost_notify", {
          ...update(),
          ...invalid,
        })
      ).success,
      false,
    );
});

test("push failures leave the recorded update intact and retries do not resend it", async (t) => {
  const { directory, agentId, runId, db } = await fixture(t);
  let submissions = 0;
  const options = {
    directory,
    send: async () => {
      submissions++;
      throw { statusCode: 503, body: "private provider details" };
    },
  };
  const input = update();
  const result = await run(notifyAgent(agentId, runId, input, options));
  assert.equal(result.recorded, true);
  assert.equal(result.delivery.status, "failed");
  assert.doesNotMatch(JSON.stringify(result), /private provider details/);
  assert.equal(
    (await run(notifyAgent(agentId, runId, input, options))).duplicate,
    true,
  );
  assert.equal(submissions, 1);
  assert.equal(
    await db(
      (store) =>
        store.prepare("SELECT count(*) AS count FROM timeline").get()?.count,
    ),
    1,
  );
});

test("a failed conversation write rolls back the event so a retry can still submit it", async (t) => {
  const { directory, agentId, runId, db } = await fixture(t);
  await db((store) =>
    store.exec(
      "CREATE TRIGGER reject_notice BEFORE INSERT ON timeline BEGIN SELECT RAISE(ABORT, 'test failure'); END;",
    ),
  );
  let submissions = 0;
  const options = {
    directory,
    send: async () => {
      submissions++;
      return { statusCode: 201, headers: {}, body: "" };
    },
  };
  const input = update();
  await assert.rejects(run(notifyAgent(agentId, runId, input, options)));
  assert.equal(submissions, 0);
  assert.equal(
    await db(
      (store) =>
        store.prepare("SELECT hasAgentUpdate FROM runs WHERE id=?").get(runId)
          ?.hasAgentUpdate,
    ),
    0,
  );
  assert.equal(
    await db(
      (store) =>
        store.prepare("SELECT count(*) AS count FROM agent_notifications").get()
          ?.count,
    ),
    0,
  );
  await db((store) => store.exec("DROP TRIGGER reject_notice"));
  assert.equal(
    (await run(notifyAgent(agentId, runId, input, options))).duplicate,
    false,
  );
  assert.equal(submissions, 1);
});
