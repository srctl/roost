import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { AuthStore, digest } from "../src/server/auth/store.server";
import { updatesRequest } from "../src/server/updates.server";

test("HTTP update authorization rechecks a native session after reading a slow request body", async () => {
  const directory = await mkdtemp("/tmp/roost-update-http-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const store = new AuthStore(directory);
  try {
    const origin = "https://roost.example";
    store.setup(origin);
    const secret = store.createSession("test-credential");
    const cookie = `__Host-roost-session=${secret}`;
    const status = await (
      await updatesRequest(
        new Request(`${origin}/api/updates`, { headers: { cookie } }),
      )
    ).json();
    assert.ok(status.csrf);
    for (const query of [
      "?key=short",
      `?key=${"x".repeat(101)}`,
      "?key=abcdefghijklmnop&key=abcdefghijklmnop",
      "?path=/etc/passwd",
    ]) {
      assert.equal(
        (
          await updatesRequest(
            new Request(`${origin}/api/updates${query}`, {
              headers: { cookie },
            }),
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await updatesRequest(
          new Request(`${origin}/api/updates?key=abcdefghijklmnop`, {
            headers: { cookie },
          }),
        )
      ).status,
      200,
    );
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const request = new Request(`${origin}/api/updates`, {
      method: "POST",
      headers: {
        cookie,
        origin,
        "Content-Type": "application/json",
        "X-Roost-CSRF": status.csrf,
      },
      body,
      duplex: "half",
    } as RequestInit);
    const pending = updatesRequest(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    store.revokeSession(digest(secret));
    controller.enqueue(new TextEncoder().encode("{}"));
    controller.close();
    assert.equal((await pending).status, 403);
    assert.equal(
      (
        await updatesRequest(
          new Request(`${origin}/api/updates`, { headers: { cookie } }),
        )
      ).status,
      401,
    );
  } finally {
    store.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
