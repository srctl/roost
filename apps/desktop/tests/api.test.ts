import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { RoostAPI, serverOrigin } from "../src/api";

test("the API refuses unsafe origins and never follows credential-bearing redirects", async () => {
  for (const origin of [
    "http://remote.example",
    "https://name:password@example.com",
    "https://example.com/path",
    "https://example.com?token=secret",
    "file:///tmp/app",
  ])
    assert.throws(() => serverOrigin(origin));
  assert.equal(serverOrigin("http://127.0.0.1:1234"), "http://127.0.0.1:1234");
  let reached = false;
  const destination = createServer((_req, res) => {
    reached = true;
    res.end("{}");
  });
  await new Promise<void>((resolve) =>
    destination.listen(0, "127.0.0.1", resolve),
  );
  const address = destination.address();
  assert.ok(address && typeof address !== "string");
  const source = createServer((_req, res) => {
    res.writeHead(302, { Location: `http://127.0.0.1:${address.port}/leak` });
    res.end();
  });
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  const origin = source.address();
  assert.ok(origin && typeof origin !== "string");
  try {
    const api = new RoostAPI(
      `http://127.0.0.1:${origin.port}`,
      `roost_mobile_${"a".repeat(43)}`,
    );
    await assert.rejects(api.request("session"));
    assert.equal(reached, false);
  } finally {
    source.close();
    destination.close();
  }
});
