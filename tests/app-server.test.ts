import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { openAppServer } from "../src/server/codex/app-server.server";
const fixture = fileURLToPath(
  new URL("./fixtures/app-server.mjs", import.meta.url),
);

test("handshake precedes calls and responses are correlated by id", async () => {
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* openAppServer(process.execPath, [fixture]);
        yield* client.initialize;
        return yield* Effect.all(
          [
            client.request("echo", { delay: 25, value: "first" }),
            client.request("echo", { value: "second" }),
          ],
          { concurrency: "unbounded" },
        );
      }),
    ),
  );
  assert.deepEqual(result, [
    { delay: 25, value: "first" },
    { value: "second" },
  ]);
});
for (const method of ["exit", "invalid"]) {
  test(`${method} fails pending calls without hanging`, async () => {
    await assert.rejects(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* openAppServer(process.execPath, [fixture]);
            yield* client.initialize;
            yield* Effect.all(
              [client.request("wait", {}), client.request(method, {})],
              { concurrency: "unbounded" },
            );
          }),
        ),
      ),
      /Codex/,
    );
  });
}
test("missing CLI is a recoverable connection error", async () => {
  await assert.rejects(
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* openAppServer("/nonexistent/roost-codex");
          yield* client.initialize;
        }),
      ),
    ),
    /Could not start Codex/,
  );
});
