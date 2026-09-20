import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Deferred, Effect, Fiber, TestClock, TestContext } from "effect";
import { openAppServer } from "../src/server/codex/app-server.server";

const fixture = fileURLToPath(
  new URL("./fixtures/app-server-failure.mjs", import.meta.url),
);

test("Codex request timeout diagnostics identify the method without exposing parameters", async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => logs.push(args));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* openAppServer(process.execPath, [fixture]);
        const waiting = yield* Deferred.make<void>();
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            client.subscribe(
              (method) => {
                if (method === "test/waiting")
                  Effect.runSync(Deferred.succeed(waiting, undefined));
              },
              () => {},
            ),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        const request = yield* client
          .request("test/stall", {
            token: "private-test-credential",
            prompt: "private-test-prompt",
          })
          .pipe(Effect.fork);
        yield* Deferred.await(waiting);
        yield* TestClock.adjust("15 seconds");
        const error = yield* Fiber.join(request).pipe(Effect.flip);
        assert.match(error.message, /too long to respond/);
      }),
    ).pipe(Effect.provide(TestContext.TestContext)),
  );
  assert.deepEqual(logs, [
    [
      "[roost:codex]",
      JSON.stringify({
        event: "request_timeout",
        method: "test/stall",
        timeoutMs: 15_000,
      }),
    ],
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /private-test/);
});

test("invalid protocol diagnostics include size and shape, never the raw line", async (t) => {
  const logs: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => logs.push(args));
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* openAppServer(process.execPath, [fixture]);
          yield* client.request("test/invalid", {});
        }),
      ),
    ),
    /invalid protocol message/,
  );
  assert.equal(logs.length, 1);
  const diagnostic = JSON.parse(String(logs[0]![1]));
  assert.equal(diagnostic.event, "invalid_protocol_message");
  assert.equal(diagnostic.shape, "other");
  assert.equal(
    diagnostic.bytes,
    Buffer.byteLength(
      "private provider output must never appear in diagnostics",
    ),
  );
  assert.doesNotMatch(JSON.stringify(logs), /private provider/);
});
