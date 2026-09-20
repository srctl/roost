import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Deferred,
  Effect,
  Fiber,
  Option,
  TestClock,
  TestContext,
} from "effect";
import {
  isReplyProgress,
  type ReplyActivity,
  withReplyTimeout,
} from "../src/server/codex/reply-timeout.server";

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));

const pendingReply = (reflecting = false) =>
  Effect.gen(function* () {
    const ready = yield* Deferred.make<ReplyActivity>();
    let cleanedUp = false;
    const fiber = yield* withReplyTimeout(
      (activity) =>
        Deferred.succeed(ready, activity).pipe(
          Effect.zipRight(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              cleanedUp = true;
            }),
          ),
        ),
      reflecting,
    ).pipe(Effect.fork);
    return {
      fiber,
      activity: yield* Deferred.await(ready),
      cleanedUp: () => cleanedUp,
    };
  });

test("ongoing progress survives the old wall-clock cutoff and expires only after inactivity", () =>
  run(
    Effect.gen(function* () {
      const reply = yield* pendingReply();
      for (let turn = 0; turn < 4; turn++) {
        yield* TestClock.adjust("9 minutes");
        reply.activity.progress();
        assert.ok(Option.isNone(yield* Fiber.poll(reply.fiber)));
      }
      yield* TestClock.adjust("9 minutes");
      assert.ok(Option.isNone(yield* Fiber.poll(reply.fiber)));
      yield* TestClock.adjust("1 minute");
      const error = yield* Fiber.join(reply.fiber).pipe(Effect.flip);
      assert.match(error.message, /stopped responding for 10 minutes/);
      assert.equal(reply.cleanedUp(), true);
    }),
  ));

test("nested approval waits pause inactivity until all requests settle, with idempotent cleanup", () =>
  run(
    Effect.gen(function* () {
      const reply = yield* pendingReply();
      yield* TestClock.adjust("9 minutes");
      const first = reply.activity.pauseForApproval();
      const second = reply.activity.pauseForApproval();
      yield* TestClock.adjust("30 minutes");
      first();
      first();
      yield* TestClock.adjust("30 minutes");
      assert.ok(Option.isNone(yield* Fiber.poll(reply.fiber)));
      second();
      yield* TestClock.adjust("9 minutes");
      assert.ok(Option.isNone(yield* Fiber.poll(reply.fiber)));
      yield* TestClock.adjust("1 minute");
      const error = yield* Fiber.join(reply.fiber).pipe(Effect.flip);
      assert.match(error.message, /stopped responding/);
      assert.equal(reply.cleanedUp(), true);
    }),
  ));

test("Stop interrupts an approval-paused reply and executes cleanup", () =>
  run(
    Effect.gen(function* () {
      const reply = yield* pendingReply();
      const resume = reply.activity.pauseForApproval();
      yield* TestClock.adjust("30 minutes");
      yield* Fiber.interrupt(reply.fiber);
      assert.equal(reply.cleanedUp(), true);
      resume();
      yield* TestClock.adjust("30 minutes");
      assert.ok(Option.isSome(yield* Fiber.poll(reply.fiber)));
    }),
  ));

test("reflection retains its absolute two-minute limit despite progress or approval callbacks", () =>
  run(
    Effect.gen(function* () {
      const reply = yield* pendingReply(true);
      yield* TestClock.adjust("1 minute");
      reply.activity.progress();
      reply.activity.pauseForApproval();
      yield* TestClock.adjust("1 minute");
      const error = yield* Fiber.join(reply.fiber).pipe(Effect.flip);
      assert.equal(error.message, "The reply timed out. Please try again.");
      assert.equal(reply.cleanedUp(), true);
    }),
  ));

test("only progress for the current provider turn extends its liveness window", () => {
  const current = { threadId: "thread", turnId: "turn" };
  assert.equal(
    isReplyProgress("item/agentMessage/delta", current, "thread", "turn"),
    true,
  );
  assert.equal(
    isReplyProgress("item/mcpToolCall/progress", current, "thread", "turn"),
    true,
  );
  assert.equal(
    isReplyProgress("roost/steer", current, "thread", "turn"),
    false,
  );
  assert.equal(
    isReplyProgress("thread/status/changed", current, "thread", "turn"),
    false,
  );
  assert.equal(
    isReplyProgress("item/started", current, "other", "turn"),
    false,
  );
  assert.equal(
    isReplyProgress("item/completed", current, "thread", "old-turn"),
    false,
  );
  assert.equal(
    isReplyProgress("item/completed", current, "thread", undefined),
    false,
  );
  assert.equal(
    isReplyProgress(
      "turn/completed",
      { threadId: "thread", turn: { id: "turn" } },
      "thread",
      "turn",
    ),
    true,
  );
});
