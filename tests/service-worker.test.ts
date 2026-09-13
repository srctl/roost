import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf8",
);

function worker(fetch: (request: { url: string }) => Promise<Response>) {
  const listeners = new Map<string, (event: unknown) => void>();
  const entries = new Map<string, Response>();
  const key = (request: { url: string }) => request.url;
  const cache = {
    match: async (request: { url: string }) =>
      entries.get(key(request))?.clone(),
    put: async (request: { url: string }, response: Response) => {
      entries.set(key(request), response);
    },
    keys: async () => [...entries.keys()].map((url) => ({ url })),
    delete: async (request: { url: string }) => entries.delete(key(request)),
  };
  runInNewContext(source, {
    URL,
    Response,
    fetch,
    caches: { open: async () => cache },
    self: {
      location: { origin: "https://roost.test" },
      addEventListener: (name: string, listener: (event: unknown) => void) =>
        listeners.set(name, listener),
    },
  });
  return {
    entries,
    async request(
      path: string,
      mode = "cors",
      preloadResponse?: Promise<Response>,
    ) {
      let response: Promise<Response> | undefined;
      const pending: Promise<unknown>[] = [];
      listeners.get("fetch")!({
        request: {
          url: new URL(path, "https://roost.test").href,
          method: "GET",
          mode,
        },
        preloadResponse,
        respondWith: (value: Promise<Response>) => {
          response = value;
        },
        waitUntil: (value: Promise<unknown>) => pending.push(value),
      });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
  };
}

test("PWA caches immutable build assets but keeps pages, APIs, and sign-in redirects out", async () => {
  let reads = 0;
  const sw = worker(async () => {
    reads++;
    return new Response("export default 1", {
      headers: {
        "Content-Type": "text/javascript",
        "Cache-Control": "public, immutable",
      },
    });
  });
  const asset = "/assets/index-1234abcd.js";
  assert.equal(await (await sw.request(asset))?.text(), "export default 1");
  assert.equal(await (await sw.request(asset))?.text(), "export default 1");
  assert.equal(reads, 1);
  for (const path of [
    "/api/files",
    "/_serverFn/read",
    "/assets/index.js",
    `${asset}?private=true`,
    `https://other.test${asset}`,
  ]) {
    assert.equal(await sw.request(path), undefined);
  }
  await sw.request("/agents/private", "navigate");
  await sw.request("/agents/private", "navigate");
  assert.equal(reads, 3);
  assert.equal(sw.entries.size, 1);

  const signIn = worker(
    async () =>
      new Response("Sign in", {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, immutable",
        },
      }),
  );
  await signIn.request(asset);
  assert.equal(signIn.entries.size, 0);
  const redirect = worker(async () => {
    const response = new Response("redirected code", {
      headers: {
        "Content-Type": "text/javascript",
        "Cache-Control": "public, immutable",
      },
    });
    Object.defineProperty(response, "redirected", { value: true });
    return response;
  });
  await redirect.request(asset);
  assert.equal(redirect.entries.size, 0);
  const privateAsset = worker(
    async () =>
      new Response("Private data", {
        headers: {
          "Content-Type": "text/javascript",
          "Cache-Control": "private, immutable",
        },
      }),
  );
  await privateAsset.request(asset);
  assert.equal(privateAsset.entries.size, 0);
});

test("PWA navigation uses preloaded network responses and provides an uncached offline fallback", async () => {
  let reads = 0;
  const sw = worker(async () => {
    reads++;
    throw new Error("offline");
  });
  const preloaded = await sw.request(
    "/",
    "navigate",
    Promise.resolve(new Response("Fresh page")),
  );
  assert.equal(await preloaded?.text(), "Fresh page");
  assert.equal(reads, 0);
  const offline = await sw.request("/", "navigate");
  assert.equal(offline?.status, 503);
  assert.equal(offline?.headers.get("Cache-Control"), "no-store");
  assert.match(await offline!.text(), /You're offline/);
  assert.equal(sw.entries.size, 0);
});

test("notification links accept only same-origin agent and conversation UUIDs", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const opened: string[] = [];
  runInNewContext(source, {
    URL,
    Response,
    self: {
      location: { origin: "https://roost.test" },
      addEventListener: (name: string, fn: (event: unknown) => void) =>
        listeners.set(name, fn),
      clients: {
        matchAll: async () => [],
        openWindow: async (url: string) => opened.push(url),
      },
    },
  });
  const agent = "11111111-1111-4111-8111-111111111111";
  const child = "22222222-2222-4222-8222-222222222222";
  for (const [url, expected] of [
    [`/agents/${agent}`, `/agents/${agent}`],
    [
      `/agents/${agent}?conversation=${child}`,
      `/agents/${agent}?conversation=${child}`,
    ],
    [`https://evil.test/agents/${agent}`, "/"],
    [`/agents/${agent}?conversation=${child}&admin=true`, "/"],
    [`/agents/${agent}?conversation=${child}&conversation=${child}`, "/"],
    [`/agents/${agent}?conversation=bad`, "/"],
    [`/agents/${agent}#unsupported`, "/"],
  ]) {
    let pending: Promise<unknown> | undefined;
    listeners.get("notificationclick")!({
      notification: { close() {}, data: { url } },
      waitUntil: (p: Promise<unknown>) => (pending = p),
    });
    await pending;
    assert.equal(opened.at(-1), `https://roost.test${expected}`);
  }
});
