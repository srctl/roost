import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { AuthStore } from "../src/server/auth/store.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

// Built Nitro handler + native Authorization headers + disposable RFB stub.
// No real desktop, credentials, or external connections are used.
class NativeSocket {
  private buffer = Buffer.alloc(0);
  private frames: { opcode: number; data: Buffer }[] = [];
  private events = new EventEmitter();
  readonly closed: Promise<void>;
  closeCode?: number;
  constructor(
    readonly socket: Duplex,
    head: Buffer,
  ) {
    this.closed = new Promise((resolve) => socket.once("close", resolve));
    socket.on("error", () => socket.destroy());
    socket.on("data", (data: Buffer) => this.receive(data));
    if (head.length) this.receive(head);
  }
  private receive(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      assert.equal(this.buffer[1] & 0x80, 0, "server frames are unmasked");
      let length = this.buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      assert.ok(length <= 16 * 1024 * 1024, "bounded fixture frame");
      if (this.buffer.length < offset + length) return;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 8) {
        this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        if (!this.socket.destroyed) this.send(payload, 8);
        this.socket.end();
      } else if (opcode === 9) this.send(payload, 10);
      else {
        this.frames.push({ opcode, data: payload });
        this.events.emit("frame");
      }
    }
  }
  send(data: Buffer, opcode = 2) {
    assert.ok(data.length < 126, "fixture uses short client frames");
    const mask = randomBytes(4);
    const encoded = Buffer.from(data);
    for (let index = 0; index < encoded.length; index++)
      encoded[index] ^= mask[index % 4];
    this.socket.write(
      Buffer.concat([
        Buffer.from([0x80 | opcode, 0x80 | data.length]),
        mask,
        encoded,
      ]),
    );
  }
  async nextFrame() {
    if (!this.frames.length)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          clearTimeout(timer);
          this.events.off("frame", ready);
          resolve();
        };
        const timer = setTimeout(() => {
          this.events.off("frame", ready);
          reject(new Error("Timed out waiting for native desktop frame."));
        }, 5000);
        this.events.once("frame", ready);
      });
    return this.frames.shift()!;
  }
}

const directory = mkdtempSync(join(tmpdir(), "roost-mobile-desktop-"));
const clients = new Set<NativeSocket>();
const vncSockets = new Set<Socket>();
const greeting = Buffer.from("RFB 003.008\n");
let received = Buffer.alloc(0);
const vnc = createServer((socket) => {
  vncSockets.add(socket);
  socket.on("close", () => vncSockets.delete(socket));
  socket.on("error", () => socket.destroy());
  socket.write(greeting);
  socket.on("data", (data) => {
    received = Buffer.concat([received, data]);
    socket.write(Buffer.from("fixture-ack"));
  });
});
await new Promise<void>((resolve) => vnc.listen(0, "127.0.0.1", resolve));
const vncPort = (vnc.address() as { port: number }).port;
const reservation = createServer();
await new Promise<void>((resolve) =>
  reservation.listen(0, "127.0.0.1", resolve),
);
const port = (reservation.address() as { port: number }).port;
await new Promise<void>((resolve) => reservation.close(() => resolve()));
const origin = `http://localhost:${port}`;
const auth = new AuthStore(directory);
auth.setup(origin);
auth.close();
const tokens = new MobileTokens(directory);
const device = tokens.create("Native desktop smoke fixture");
const other = tokens.create("Other fixture device");
tokens.close();
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env: {
    ...process.env,
    ROOST_DATA_DIR: directory,
    ROOST_DESKTOP_DISPLAY: ":99",
    ROOST_DESKTOP_ORIGIN: origin,
    ROOST_DESKTOP_VNC_PORT: String(vncPort),
    HOST: "127.0.0.1",
    PORT: String(port),
  },
  stdio: ["ignore", "ignore", "ignore"],
});
const endpoint = `${origin}/api/mobile/v1`;
const headers = { Authorization: `Bearer ${device.secret}` };
async function ticket(secret = device.secret) {
  const result = await fetch(`${endpoint}/computer/viewer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(result.status, 200, "native viewer ticket issued");
  return ((await result.json()) as { id: string }).id;
}
function upgrade(
  id: string,
  secret: string | null,
  extra: Record<string, string> = {},
): Promise<{ status: number; client?: NativeSocket }> {
  return new Promise((resolve, reject) => {
    const req = request(
      `${endpoint}/computer/socket?ticket=${encodeURIComponent(id)}`,
      {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
          ...extra,
        },
      },
    );
    req.setTimeout(5000, () =>
      req.destroy(new Error("Native desktop upgrade timed out.")),
    );
    req.on("error", reject);
    req.on("response", (response) => {
      response.resume();
      resolve({ status: response.statusCode! });
    });
    req.on("upgrade", (response, socket, head) => {
      const client = new NativeSocket(socket, head);
      clients.add(client);
      resolve({ status: response.statusCode!, client });
    });
    req.end();
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Production server exited.");
    try {
      ready = (await fetch(`${origin}/api/health`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, "production server ready");
  assert.equal((await fetch(`${endpoint}/computer`)).status, 401);
  const status = await fetch(`${endpoint}/computer`, { headers });
  assert.equal(status.status, 200);
  assert.equal(((await status.json()) as { enabled: boolean }).enabled, true);
  const id = await ticket();
  assert.equal(
    (await upgrade(id, null)).status,
    403,
    "ticket alone is insufficient",
  );
  assert.equal(
    (await upgrade(id, `roost_mobile_${"z".repeat(43)}`)).status,
    403,
    "wrong token rejected",
  );
  assert.equal(
    (await upgrade(id, other.secret)).status,
    403,
    "ticket belongs to issuing device",
  );
  assert.equal(
    (await upgrade(id, device.secret, { Origin: origin })).status,
    403,
    "matching browser origin rejected",
  );
  assert.equal(
    (await upgrade(id, device.secret, { Origin: "https://untrusted.example" }))
      .status,
    403,
    "foreign origin rejected",
  );
  assert.equal(
    (await upgrade(id, device.secret, { "Sec-Fetch-Site": "cross-site" }))
      .status,
    403,
    "cross-site upgrade rejected",
  );
  assert.equal(
    (await upgrade("invalid", device.secret)).status,
    403,
    "invalid ticket rejected",
  );
  const connected = await upgrade(id, device.secret);
  assert.equal(connected.status, 101, "valid native socket upgrades");
  const client = connected.client!;
  const first = await client.nextFrame();
  assert.equal(first.opcode, 2, "RFB bytes use a binary frame");
  assert.deepEqual(
    first.data,
    greeting,
    "native socket receives desktop bytes",
  );
  client.send(greeting);
  assert.equal(
    (await client.nextFrame()).data.toString(),
    "fixture-ack",
    "native input reaches TCP desktop",
  );
  assert.deepEqual(received, greeting);
  assert.equal(
    (await upgrade(id, device.secret)).status,
    403,
    "connected tickets cannot be replayed",
  );
  const control = await fetch(`${endpoint}/computer/control`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id, control: true }),
  });
  assert.equal(control.status, 200);
  assert.equal(
    ((await control.json()) as { controlling: boolean }).controlling,
    true,
  );
  assert.equal(
    (
      await fetch(`${endpoint}/computer/control`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${other.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, control: true }),
      })
    ).status,
    409,
    "other devices cannot acquire control using this ticket",
  );
  assert.equal(
    (await fetch(`${endpoint}/session`, { method: "DELETE", headers })).status,
    200,
  );
  await Promise.race([
    client.closed,
    delay(5000).then(() => {
      throw new Error("Revoked native desktop socket remained open.");
    }),
  ]);
  assert.equal(
    client.closeCode,
    1008,
    "revoked device gets an authentication close",
  );
  assert.equal(
    (await upgrade(await ticket(other.secret), device.secret)).status,
    403,
    "revoked device cannot reconnect",
  );
  console.log(
    "Production mobile desktop smoke passed: authenticated binary bridge, device-bound one-use tickets, browser-origin rejection, control ownership, and live revocation.",
  );
} finally {
  for (const client of clients) client.socket.destroy();
  for (const socket of vncSockets) socket.destroy();
  await new Promise<void>((resolve) => vnc.close(() => resolve()));
  const stopped = new Promise<void>((resolve) =>
    server.once("exit", () => resolve()),
  );
  server.kill("SIGTERM");
  await Promise.race([stopped, delay(3000)]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await stopped;
  }
  rmSync(directory, { recursive: true, force: true });
}
