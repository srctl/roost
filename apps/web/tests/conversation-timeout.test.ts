import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Effect, Fiber, Option, TestClock, TestContext } from "effect";
import type { ChatEvent, SendMessage } from "../src/features/chat/schema";
import { saveAgent } from "../src/server/agents/store.server";
import {
  answerApproval,
  readApprovals,
} from "../src/server/approvals/store.server";
import { closeAgentRuntimes } from "../src/server/codex/agent-runtime.server";
import { sendConversation } from "../src/server/codex/conversation.server";
import {
  claimRun,
  enqueueChat,
  schedulerTick,
} from "../src/server/runs/store.server";

const run = Effect.runPromise;

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for reply state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(task: (agentId: string) => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-conversation-timeout-");
  const previous = {
    ROOST_DATA_DIR: process.env.ROOST_DATA_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    ROOST_CODEX_BINARY: process.env.ROOST_CODEX_BINARY,
  };
  Object.assign(process.env, {
    ROOST_DATA_DIR: directory,
    CODEX_HOME: directory,
    ROOST_CODEX_BINARY: fileURLToPath(
      new URL("./fixtures/chat-server.mjs", import.meta.url),
    ),
  });
  writeFileSync(
    join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "fake" }),
  );
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Timeout",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    await task(agent.id);
  } finally {
    await closeAgentRuntimes();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test("an accepted follow-up keeps the real conversation alive past its original deadline", () =>
  fixture(async (agentId) => {
    const input = { agentId, messageId: randomUUID(), text: "steer-wait" };
    const events: ChatEvent[] = [];
    const queue: SendMessage[] = [];
    const received = (id: string) =>
      events.some(
        (event) => event.type === "message" && event.message.id === id,
      );
    await run(
      Effect.gen(function* () {
        const fiber = yield* sendConversation(
          input,
          (event) => events.push(event),
          undefined,
          "chat",
          Effect.sync(() => queue.shift()),
        ).pipe(Effect.fork);
        yield* Effect.promise(() => until(() => received(input.messageId)));
        yield* TestClock.adjust("9 minutes");
        const next = { agentId, messageId: randomUUID(), text: "Keep working" };
        queue.push(next);
        yield* Effect.promise(() => until(() => received(next.messageId)));
        yield* TestClock.adjust("9 minutes");
        assert.ok(Option.isNone(yield* Fiber.poll(fiber)));
        queue.push({
          agentId,
          messageId: randomUUID(),
          text: "finish steering",
        });
        yield* Fiber.join(fiber);
        assert.deepEqual(events.at(-1), { type: "done", status: "completed" });
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  }));

for (const kind of ["action", "command"]) {
  test(`${kind} approval remains actionable after 30 minutes and resumes only after its answer`, () =>
    fixture(async (agentId) => {
      const input = {
        agentId,
        messageId: randomUUID(),
        text: `approval:${kind}`,
      };
      await run(enqueueChat(input));
      await run(schedulerTick("timeout-test"));
      assert.equal((await run(claimRun("timeout-test")))?.id, input.messageId);
      const events: ChatEvent[] = [];
      await run(
        Effect.gen(function* () {
          const fiber = yield* sendConversation(input, (event) =>
            events.push(event),
          ).pipe(Effect.fork);
          yield* Effect.promise(() =>
            until(async () => (await run(readApprovals(agentId))).length === 1),
          );
          yield* TestClock.adjust("30 minutes");
          assert.ok(Option.isNone(yield* Fiber.poll(fiber)));
          const approval = (yield* readApprovals(agentId))[0]!;
          assert.equal(approval.status, "pending");
          assert.equal(
            events.some((event) => event.type === "done"),
            false,
          );
          yield* answerApproval(agentId, approval.id, { decision: "approve" });
          yield* Fiber.join(fiber);
          assert.deepEqual(events.at(-1), {
            type: "done",
            status: "completed",
          });
          assert.equal(
            (yield* readApprovals(agentId, approval.id))[0]?.status,
            "answered",
          );
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    }));
}

test("empty steering polls do not keep a silent turn alive, and timeout releases the conversation", () =>
  fixture(async (agentId) => {
    const input = { agentId, messageId: randomUUID(), text: "steer-wait" };
    const events: ChatEvent[] = [];
    await run(
      Effect.gen(function* () {
        const fiber = yield* sendConversation(
          input,
          (event) => events.push(event),
          undefined,
          "chat",
          Effect.succeed(undefined),
        ).pipe(Effect.fork);
        yield* Effect.promise(() =>
          until(() =>
            events.some(
              (event) =>
                event.type === "message" &&
                event.message.id === input.messageId,
            ),
          ),
        );
        yield* TestClock.adjust("10 minutes");
        const error = yield* Fiber.join(fiber).pipe(Effect.flip);
        assert.match(error.message, /stopped responding for 10 minutes/);
        yield* sendConversation(
          { agentId, messageId: randomUUID(), text: "finish steering" },
          (event) => events.push(event),
        );
        assert.deepEqual(events.at(-1), { type: "done", status: "completed" });
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  }));

test("interrupting a long approval wait cancels its request without approving it", () =>
  fixture(async (agentId) => {
    const input = { agentId, messageId: randomUUID(), text: "approval:action" };
    await run(enqueueChat(input));
    await run(schedulerTick("timeout-test"));
    await run(claimRun("timeout-test"));
    await run(
      Effect.gen(function* () {
        const fiber = yield* sendConversation(input, () => {}).pipe(
          Effect.fork,
        );
        yield* Effect.promise(() =>
          until(async () => (await run(readApprovals(agentId))).length === 1),
        );
        const approval = (yield* readApprovals(agentId))[0]!;
        yield* TestClock.adjust("30 minutes");
        yield* Fiber.interrupt(fiber);
        yield* Effect.promise(() =>
          until(
            async () =>
              (await run(readApprovals(agentId, approval.id)))[0]?.status ===
              "cancelled",
          ),
        );
        const cancelled = (yield* readApprovals(agentId, approval.id))[0]!;
        assert.equal(cancelled.response, null);
        const error = yield* answerApproval(agentId, approval.id, {
          decision: "approve",
        }).pipe(Effect.flip);
        assert.match(error.message, /already resolved/);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  }));
