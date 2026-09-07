import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { compressHtml } from "../src/server/html-compression.server";

function request(encoding?: string, method = "GET") {
  return new Request("https://roost.test/agents/agent-id", {
    method,
    headers: encoding === undefined ? {} : { "Accept-Encoding": encoding },
  });
}

function html(
  body: BodyInit | null = "<html>Roost</html>",
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type"))
    headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

test("gzip HTML preserves private response metadata and cookies", async () => {
  const content = `<html>${"A conversation message. ".repeat(1_000)}</html>`;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Length": String(Buffer.byteLength(content)),
    Vary: "Cookie",
    ETag: '"html-version"',
  });
  headers.append("Set-Cookie", "one=1; Path=/; HttpOnly");
  headers.append("Set-Cookie", "two=2; Path=/; Secure");
  const result = compressHtml(
    request("gzip"),
    html(content, {
      status: 404,
      statusText: "Not Found",
      headers,
    }),
  );
  assert.equal(result.status, 404);
  assert.equal(result.statusText, "Not Found");
  assert.equal(result.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(result.headers.getSetCookie(), headers.getSetCookie());
  assert.equal(result.headers.get("Vary"), "Cookie, Accept-Encoding");
  assert.equal(result.headers.get("Content-Encoding"), "gzip");
  assert.equal(result.headers.get("Content-Length"), null);
  assert.equal(result.headers.get("ETag"), 'W/"html-version"');
  const compressed = Buffer.from(await result.arrayBuffer());
  assert.equal(gunzipSync(compressed).toString(), content);
  assert.ok(compressed.length < Buffer.byteLength(content) / 10);
});

test("HTML varies by encoding and respects explicit gzip quality before wildcard", async () => {
  for (const [encoding, gzip] of [
    [undefined, false],
    ["br", false],
    ["gzip;q=0, *;q=1", false],
    ["gzip;q=0.000", false],
    ["gzip;q=invalid", false],
    ["gzip;q=2", false],
    ["*;q=0.5", true],
    ["br, GZIP; q=0.5", true],
  ] as const) {
    const result = compressHtml(request(encoding), html());
    assert.equal(
      result.headers.get("Content-Encoding"),
      gzip ? "gzip" : null,
      encoding,
    );
    assert.equal(result.headers.get("Vary"), "Accept-Encoding", encoding);
    const bytes = Buffer.from(await result.arrayBuffer());
    assert.equal(
      (gzip ? gunzipSync(bytes) : bytes).toString(),
      "<html>Roost</html>",
    );
  }
  for (const vary of ["Cookie, accept-encoding", "*"]) {
    const result = compressHtml(
      request("gzip"),
      html("<html>Roost</html>", { headers: { Vary: vary } }),
    );
    assert.equal(result.headers.get("Vary"), vary);
    await result.arrayBuffer();
  }
});

test("leaves HEAD, empty, partial, preencoded, non-HTML, and no-transform responses untouched", () => {
  for (const [req, response] of [
    [request("gzip", "HEAD"), html()],
    [request("gzip"), html(null, { status: 204 })],
    [request("gzip"), html("partial", { status: 206 })],
    [
      request("gzip"),
      html("partial", { headers: { "Content-Range": "bytes 0-6/20" } }),
    ],
    [
      request("gzip"),
      html("encoded", { headers: { "Content-Encoding": "br" } }),
    ],
    [
      request("gzip"),
      html("{}", { headers: { "Content-Type": "application/json" } }),
    ],
    [
      request("gzip"),
      html("private", {
        headers: { "Cache-Control": "private, no-transform" },
      }),
    ],
  ] as const) {
    assert.equal(compressHtml(req, response), response);
  }
});

test("gzip delivers the initial HTML before the source closes and cancels upstream", {
  timeout: 2_000,
}, async () => {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      source = controller;
    },
    cancel() {
      cancelled = true;
    },
  });
  const compressed = compressHtml(request("gzip"), html(body));
  const reader = compressed
    .body!.pipeThrough(new DecompressionStream("gzip"))
    .getReader();
  source.enqueue(new TextEncoder().encode("<html>Initial shell"));
  assert.equal(
    new TextDecoder().decode((await reader.read()).value),
    "<html>Initial shell",
  );
  await reader.cancel();
  // Web Stream cancellation propagates through the zlib adapter asynchronously.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("source failures reject the compressed response body", async () => {
  const failure = new Error("SSR render failed");
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(failure);
    },
  });
  await assert.rejects(
    compressHtml(request("gzip"), html(body)).arrayBuffer(),
    /SSR render failed/,
  );
});
