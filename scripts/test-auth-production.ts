import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AuthStore } from "../src/server/auth/store.server";
import { authenticator } from "../tests/helpers/passkey";

const temp = mkdtempSync(join(tmpdir(), "roost-auth-production-"));
const vnc = createServer((socket) => socket.write("RFB 003.008\n"));
vnc.listen(0, "127.0.0.1");
await once(vnc, "listening");
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
probe.close();
await once(probe, "close");
const origin = `http://localhost:${port}`;
const db = new AuthStore(temp);
const setup = new URL(db.setup(origin)).hash.slice(7);
const child = spawn(process.execPath, [".output/server/index.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    ROOST_DATA_DIR: temp,
    ROOST_DESKTOP_DISPLAY: ":1",
    ROOST_DESKTOP_ORIGIN: origin,
    ROOST_DESKTOP_VNC_PORT: String((vnc.address() as { port: number }).port),
    ROOST_CODEX_BINARY: "/nonexistent-test-codex",
  },
  stdio: "ignore",
});
const cookies = new Map<string, string>();
const cookieHeader = () =>
  [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
async function request(
  path: string,
  data?: unknown,
  authenticated = true,
  headers = {},
) {
  const response = await fetch(`${origin}${path}`, {
    method: data === undefined ? "GET" : "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(authenticated ? { Cookie: cookieHeader() } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (authenticated)
    for (const item of response.headers.getSetCookie()) {
      const [name, value] = item.split(";")[0]!.split("=");
      cookies.set(name!, value!);
    }
  return response;
}
const sockets: Socket[] = [];
async function upgrade(ticket: string, cookie: string, requestOrigin = origin) {
  const socket = connect(port, "127.0.0.1");
  sockets.push(socket);
  let bytes = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    bytes = Buffer.concat([bytes, chunk]);
  });
  await once(socket, "connect");
  socket.write(
    `GET /api/desktop/socket?ticket=${ticket} HTTP/1.1\r\nHost: localhost:${port}\r\nOrigin: ${requestOrigin}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\n\r\n`,
  );
  for (let i = 0; i < 50 && !bytes.includes(Buffer.from("\r\n\r\n")); i++)
    await delay(50);
  return { socket, bytes: () => bytes };
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request("/api/health")).ok) break;
    } catch {
      /* Server booting. */
    }
    if (i === 99) throw new Error("Server failed to start.");
    await delay(100);
  }
  assert.equal(
    (await request("/", undefined, false, { Accept: "text/html" })).status,
    303,
  );
  for (const path of ["/api/files", "/_serverFn/unknown", "/settings"])
    assert.equal((await request(path, undefined, false)).status, 401);
  const page = await request("/auth", undefined, false);
  assert.ok(
    page.headers
      .get("content-security-policy")
      ?.includes("frame-ancestors 'none'"),
  );
  assert.ok((await page.text()).includes("navigator.credentials"));
  const key = authenticator(origin);
  const options = await (
    await request("/auth/api/register-options", { setup })
  ).json();
  assert.equal(
    (
      await request("/auth/api/register-verify", {
        response: key.registration(options.options.challenge),
      })
    ).status,
    200,
  );
  assert.equal((await request("/settings")).status, 200);
  assert.match(
    (await request("/settings")).headers.get("cache-control")!,
    /no-store/,
  );
  const manifest = readFileSync(".output/server/_ssr/ssr.mjs", "utf8");
  const id = manifest.match(
    /"([a-f0-9]{64})":\s*\{\s*functionName: "openComputer_createServerFn_handler"/,
  )?.[1];
  assert.ok(id, "Find the built desktop server-function ID");
  assert.equal((await request(`/_serverFn/${id}`, {}, false)).status, 401);
  const ticketResponse = await fetch(`${origin}/_serverFn/${id}`, {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: cookieHeader(),
      "x-tsr-serverFn": "true",
      "Content-Type": "text/plain",
      Accept: "application/json",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(ticketResponse.status, 200);
  const ticket = (await ticketResponse.text()).match(
    /"([A-Za-z0-9_-]{43})"/,
  )?.[1];
  assert.ok(ticket, "Authenticated server function issues a desktop ticket");
  const denied = await upgrade(ticket, "");
  assert.match(denied.bytes().toString(), /HTTP\/1.1 401/);
  denied.socket.destroy();
  const wrongOrigin = await upgrade(
    ticket,
    cookieHeader(),
    "https://evil.example",
  );
  assert.match(wrongOrigin.bytes().toString(), /HTTP\/1.1 403/);
  wrongOrigin.socket.destroy();
  const viewer = await upgrade(ticket, cookieHeader());
  assert.match(viewer.bytes().toString(), /HTTP\/1.1 101/);
  for (let i = 0; i < 30 && !viewer.bytes().includes(Buffer.from("RFB")); i++)
    await delay(50);
  assert.ok(viewer.bytes().includes(Buffer.from("RFB 003.008")));
  await request("/auth/api/logout", {});
  for (
    let i = 0;
    i < 50 && !viewer.bytes().includes(Buffer.from("Sign in required"));
    i++
  )
    await delay(50);
  assert.ok(
    viewer.bytes().includes(Buffer.from("Sign in required")),
    "Revocation closes an existing desktop connection",
  );
  viewer.socket.destroy();
  assert.equal((await request("/api/files")).status, 401);
  const login = await (await request("/auth/api/login-options", {})).json();
  assert.equal(
    (
      await request("/auth/api/login-verify", {
        response: key.assertion(login.options.challenge),
      })
    ).status,
    200,
  );
  db.setup(undefined, true);
  assert.equal((await request("/api/files")).status, 401);
  console.log(
    "Production auth smoke passed: enrollment, login, private pages/API, desktop upgrade, revocation, and recovery.",
  );
} finally {
  for (const socket of sockets) socket.destroy();
  child.kill("SIGKILL");
  await once(child, "exit");
  vnc.close();
  db.close();
  rmSync(temp, { recursive: true, force: true });
}
