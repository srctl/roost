import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { authGate } from "../src/server/auth/http.server";
import {
  authenticatedSocket,
  sessionActive,
} from "../src/server/auth/session.server";
import { AuthStore, digest } from "../src/server/auth/store.server";
import { authenticator } from "./helpers/passkey";

const origin = "https://roost.example.com";
let directory: string;
let store: AuthStore;
let previous: string | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "roost-auth-test-"));
  previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
});
afterEach(() => {
  store?.close();
  if (previous === undefined) delete process.env.ROOST_DATA_DIR;
  else process.env.ROOST_DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
});
function setup() {
  store = new AuthStore(directory);
  return new URL(store.setup(origin)).hash.slice("#setup=".length);
}
function browser() {
  const cookies = new Map<string, string>();
  return {
    cookies,
    async request(
      path: string,
      data?: unknown,
      headers: Record<string, string> = {},
    ) {
      const response = await authGate(
        new Request(`${origin}${path}`, {
          method: data === undefined ? "GET" : "POST",
          headers: {
            origin,
            cookie: [...cookies]
              .map(([key, value]) => `${key}=${value}`)
              .join("; "),
            "content-type": "application/json",
            ...headers,
          },
          body: data === undefined ? undefined : JSON.stringify(data),
        }),
        () => new Response("login"),
      );
      for (const value of response?.headers.getSetCookie() ?? []) {
        const pair = value.split(";")[0]!.split("=");
        cookies.set(pair[0]!, pair[1]!);
      }
      return response;
    },
    async options(kind: string, data = {}) {
      const response = await this.request(`/auth/api/${kind}-options`, data);
      assert.equal(response?.status, 200);
      return (await response!.json()).options;
    },
    async verify(kind: string, response: unknown) {
      return this.request(`/auth/api/${kind}-verify`, { response });
    },
  };
}
async function enroll() {
  const secret = setup();
  const client = browser(),
    key = authenticator();
  const options = await client.options("register", { setup: secret });
  const result = await client.verify(
    "register",
    key.registration(options.challenge),
  );
  assert.equal(result?.status, 200);
  return { client, key, secret, result };
}

test("private-proxy mode stays unchanged without auth setup", async () => {
  assert.equal(await browser().request("/"), null);
  assert.equal(await browser().request("/_serverFn/example", {}), null);
  assert.equal(await browser().request("/api/files"), null);
  assert.equal(
    authenticatedSocket(new Request(`${origin}/api/desktop/socket`)),
    null,
  );
  assert.equal(
    (await (await browser().request("/auth/api/state"))!.json()).enabled,
    false,
  );
});
test("all private entry points are denied before setup enrollment; health still works", async () => {
  setup();
  const client = browser();
  for (const path of [
    "/",
    "/agents/private",
    "/api/files",
    "/api/desktop/socket",
    "/_serverFn/example",
  ])
    assert.equal((await client.request(path))?.status, 401, path);
  assert.equal(
    (
      await client.request("/", undefined, { accept: "text/html" })
    )?.headers.get("location"),
    "/auth",
  );
  assert.equal(await client.request("/api/health"), null);
  assert.throws(() =>
    authenticatedSocket(
      new Request(`${origin}/api/desktop/socket`, { headers: { origin } }),
    ),
  );
  assert.equal(
    (await client.request("/auth/api/register-options", {}))?.status,
    400,
  );
  assert.equal(
    (await client.request("/auth/api/register-options", { setup: "guess" }))
      ?.status,
    400,
  );
});
test("real signed enrollment and login issue secure cookies; bootstrap and challenges cannot replay", async () => {
  const { client, key, secret, result } = await enroll();
  const cookie = result!.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-roost-session="))!;
  for (const flag of ["Secure", "HttpOnly", "SameSite=Strict", "Path=/"])
    assert.ok(cookie.includes(flag));
  assert.equal(store.config().bootstrap, null);
  assert.equal(await client.request("/api/files"), null);
  assert.equal(
    (await browser().request("/auth/api/register-options", { setup: secret }))
      ?.status,
    400,
  );
  const second = browser();
  const options = await second.options("login");
  const assertion = key.assertion(options.challenge);
  assert.equal((await second.verify("login", assertion))?.status, 200);
  assert.equal((await second.verify("login", assertion))?.status, 400);
  assert.equal(await second.request("/_serverFn/example", {}), null);
  const hash = digest(second.cookies.get("__Host-roost-session")!);
  assert.ok(sessionActive(hash));
  await second.request("/auth/api/logout", {});
  assert.equal(sessionActive(hash), false);
  assert.equal((await second.request("/api/files"))?.status, 401);
});
test("wrong origin, missing user verification, bad signatures, and unbound challenges fail", async () => {
  const { key } = await enroll();
  for (const mode of ["origin", "uv", "signature", "challenge", "cookie"]) {
    const client = browser();
    const options = await client.options("login");
    const response = key.assertion(
      mode === "challenge" ? "wrong" : options.challenge,
      mode !== "uv",
      mode === "origin" ? "https://evil.example" : origin,
    );
    if (mode === "signature")
      response.response.signature = randomBytes(64).toString("base64url");
    if (mode === "cookie") client.cookies.clear();
    assert.equal((await client.verify("login", response))?.status, 400, mode);
  }
  const client = browser();
  assert.equal(
    (
      await client.request(
        "/auth/api/login-options",
        {},
        { origin: "https://evil.example" },
      )
    )?.status,
    403,
  );
  const options = await client.options("login");
  assert.equal(
    (await client.verify("login", key.assertion(options.challenge)))?.status,
    200,
  );
});
test("registration requires UV and exact origin, and setup links expire", async () => {
  const secret = setup();
  const client = browser(),
    key = authenticator();
  let options = await client.options("register", { setup: secret });
  assert.equal(
    (
      await client.verify(
        "register",
        key.registration(options.challenge, false),
      )
    )?.status,
    400,
  );
  options = await client.options("register", { setup: secret });
  assert.equal(
    (
      await client.verify(
        "register",
        key.registration(options.challenge, true, "https://evil.example"),
      )
    )?.status,
    400,
  );
  const now = Date.now;
  Date.now = () => now() + 16 * 60_000;
  try {
    assert.equal(
      (await client.request("/auth/api/register-options", { setup: secret }))
        ?.status,
      400,
    );
  } finally {
    Date.now = now;
  }
  assert.equal(store.credentials().length, 0);
});
test("add a backup passkey, prevent removing the last, revoke credentials and sessions", async () => {
  const { client, key } = await enroll();
  assert.equal(
    (await client.request("/auth/api/remove-passkey", { id: key.id }))?.status,
    400,
  );
  const second = authenticator();
  const options = await client.options("register");
  assert.equal(
    (await client.verify("register", second.registration(options.challenge)))
      ?.status,
    200,
  );
  assert.equal(store.credentials().length, 2);
  const old = browser();
  const login = await old.options("login");
  await old.verify("login", key.assertion(login.challenge));
  const oldId = digest(old.cookies.get("__Host-roost-session")!);
  assert.equal(
    (await client.request("/auth/api/remove-passkey", { id: key.id }))?.status,
    200,
  );
  assert.equal(sessionActive(oldId), false);
  const state = await (await client.request("/auth/api/state"))!.json();
  assert.equal(state.sessions.length, 1);
  await client.request("/auth/api/revoke-session", {
    id: state.sessions[0].id,
  });
  assert.equal((await client.request("/api/files"))?.status, 401);
});
test("recovery invalidates existing sessions, passkeys, and pending ceremonies", async () => {
  const { client, key } = await enroll();
  const pending = browser();
  const options = await pending.options("login");
  const next = store.setup(undefined, true);
  assert.equal(store.credentials().length, 0);
  assert.equal(
    (await pending.verify("login", key.assertion(options.challenge)))?.status,
    400,
  );
  assert.equal((await client.request("/api/files"))?.status, 401);
  const fresh = browser();
  const registration = await fresh.options("register", {
    setup: new URL(next).hash.slice(7),
  });
  assert.equal(
    (
      await fresh.verify(
        "register",
        authenticator().registration(registration.challenge),
      )
    )?.status,
    200,
  );
});
test("recent verification and expiration are enforced; rate limits bound anonymous ceremonies", async () => {
  const { client } = await enroll();
  const now = Date.now;
  try {
    Date.now = () => now() + 6 * 60_000;
    assert.equal(
      (await client.request("/auth/api/register-options", {}))?.status,
      400,
    );
    assert.equal(await client.request("/api/files"), null);
    Date.now = () => now() + 31 * 24 * 60 * 60_000;
    assert.equal((await client.request("/api/files"))?.status, 401);
  } finally {
    Date.now = now;
  }
  let response: Response | null = null;
  for (let i = 0; i < 65; i++)
    response = await browser().request("/auth/api/login-options", {});
  assert.equal(response?.status, 429);
});

test("native auth rejects alternate hosts, duplicate cookies, and oversized bodies", async () => {
  const { client } = await enroll();
  assert.equal(
    (
      await authGate(
        new Request("https://other.example/auth"),
        () => new Response(),
      )
    )?.status,
    403,
  );
  const value = client.cookies.get("__Host-roost-session")!;
  assert.equal(
    (
      await client.request("/api/files", undefined, {
        cookie: `__Host-roost-session=${value}; __Host-roost-session=${value}`,
      })
    )?.status,
    401,
  );
  assert.equal(
    (
      await client.request("/auth/api/register-options", {
        value: "x".repeat(40_000),
      })
    )?.status,
    400,
  );
  assert.throws(() => store.setup("http://public.example.com", true), /HTTPS/);
});

test("concurrent first enrollments cannot claim ownership twice", async () => {
  const secret = setup();
  const first = browser(),
    second = browser();
  const a = await first.options("register", { setup: secret });
  const b = await second.options("register", { setup: secret });
  const results = await Promise.all([
    first.verify("register", authenticator().registration(a.challenge)),
    second.verify("register", authenticator().registration(b.challenge)),
  ]);
  assert.deepEqual(results.map((result) => result?.status).sort(), [200, 400]);
  assert.equal(store.credentials().length, 1);
  assert.equal(store.sessions().length, 1);
});
