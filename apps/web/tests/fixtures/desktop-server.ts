import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { saveAgent } from "../../src/server/agents/store.server";
import { AuthStore } from "../../src/server/auth/store.server";
import { MobileTokens } from "../../src/server/mobile/tokens.server";

// Test-only native/WebKit fixture: disposable production data, local RFB
// renderer, and a public fixture token. It never connects to a real desktop.
const port = 4499;
const origin = `http://localhost:${port}`;
const directory = mkdtempSync(join(tmpdir(), "roost-native-desktop-fixture-"));
const clients = new Set<Socket>();
const width = 480;
const height = 320;

function framebufferClient(socket: Socket) {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
  socket.on("error", () => socket.destroy());
  let state: "version" | "security" | "shared" | "ready" = "version";
  let input = Buffer.alloc(0);
  let pixelBits = 32;
  let bigEndian = false;
  let redMax = 255;
  let greenMax = 255;
  let blueMax = 255;
  let redShift = 16;
  let greenShift = 8;
  let blueShift = 0;
  let dirty = true;
  let waitingForUpdate = false;
  let presses = 0;
  socket.write("RFB 003.008\n");

  function draw() {
    if (!waitingForUpdate || !dirty) return;
    waitingForUpdate = false;
    dirty = false;
    const bytesPerPixel = pixelBits / 8;
    if (![1, 2, 4].includes(bytesPerPixel)) return socket.destroy();
    const frame = Buffer.alloc(16 + width * height * bytesPerPixel);
    frame[0] = 0; // FramebufferUpdate
    frame.writeUInt16BE(1, 2); // One raw rectangle.
    frame.writeUInt16BE(width, 8);
    frame.writeUInt16BE(height, 10);
    frame.writeInt32BE(0, 12);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = (Math.floor(x / 80) + Math.floor(y / 80) + presses) % 3;
        const colors = [
          [43, 153, 130],
          [68, 103, 181],
          [221, 159, 67],
        ];
        const [r, g, b] = colors[tile];
        const pixel =
          ((Math.round((r * redMax) / 255) << redShift) |
            (Math.round((g * greenMax) / 255) << greenShift) |
            (Math.round((b * blueMax) / 255) << blueShift)) >>>
          0;
        const offset = 16 + (y * width + x) * bytesPerPixel;
        if (bytesPerPixel === 4) {
          if (bigEndian) frame.writeUInt32BE(pixel, offset);
          else frame.writeUInt32LE(pixel, offset);
        } else if (bytesPerPixel === 2) {
          if (bigEndian) frame.writeUInt16BE(pixel, offset);
          else frame.writeUInt16LE(pixel, offset);
        } else frame[offset] = pixel;
      }
    }
    socket.write(frame);
  }

  socket.on("data", (data) => {
    input = Buffer.concat([input, data]);
    while (input.length) {
      if (state === "version") {
        if (input.length < 12) return;
        if (!input.subarray(0, 12).toString().startsWith("RFB 003."))
          return socket.destroy();
        input = input.subarray(12);
        socket.write(Buffer.from([1, 1])); // One security type: None.
        state = "security";
      } else if (state === "security") {
        if (input[0] !== 1) return socket.destroy();
        input = input.subarray(1);
        socket.write(Buffer.alloc(4)); // SecurityResult OK.
        state = "shared";
      } else if (state === "shared") {
        input = input.subarray(1);
        const name = Buffer.from("Roost test desktop");
        const init = Buffer.alloc(24);
        init.writeUInt16BE(width, 0);
        init.writeUInt16BE(height, 2);
        init[4] = 32;
        init[5] = 24;
        init[6] = 0;
        init[7] = 1;
        init.writeUInt16BE(255, 8);
        init.writeUInt16BE(255, 10);
        init.writeUInt16BE(255, 12);
        init[14] = 16;
        init[15] = 8;
        init[16] = 0;
        init.writeUInt32BE(name.length, 20);
        socket.write(Buffer.concat([init, name]));
        state = "ready";
      } else {
        const type = input[0];
        let length = 0;
        if (type === 0) length = 20;
        else if (type === 2) {
          if (input.length < 4) return;
          length = 4 + input.readUInt16BE(2) * 4;
        } else if (type === 3) length = 10;
        else if (type === 4) length = 8;
        else if (type === 5) length = 6;
        else if (type === 6) {
          if (input.length < 8) return;
          length = 8 + input.readUInt32BE(4);
        } else return socket.destroy();
        if (length > 1024 * 1024) return socket.destroy();
        if (input.length < length) return;
        const message = input.subarray(0, length);
        input = input.subarray(length);
        if (type === 0) {
          pixelBits = message[4];
          bigEndian = message[6] !== 0;
          redMax = message.readUInt16BE(8);
          greenMax = message.readUInt16BE(10);
          blueMax = message.readUInt16BE(12);
          redShift = message[14];
          greenShift = message[15];
          blueShift = message[16];
          dirty = true;
        } else if (type === 3) {
          waitingForUpdate = true;
          if (message[1] === 0) dirty = true;
          draw();
        } else if (
          (type === 4 && message[1] === 1) ||
          (type === 5 && message[1] !== 0)
        ) {
          presses += 1;
          dirty = true;
          draw();
        }
      }
    }
  });
}

const vnc = createServer(framebufferClient);
await new Promise<void>((resolve) => vnc.listen(0, "127.0.0.1", resolve));
const vncPort = (vnc.address() as { port: number }).port;
const auth = new AuthStore(directory);
auth.setup(origin);
auth.close();
const tokens = new MobileTokens(directory);
const device = tokens.create("Desktop UI test");
tokens.close();
const db = new DatabaseSync(join(directory, "mobile.sqlite"));
db.prepare("UPDATE devices SET hash=? WHERE id=?").run(
  createHash("sha256")
    .update(`roost_mobile_${"a".repeat(43)}`)
    .digest("hex"),
  device.id,
);
db.close();
await Effect.runPromise(
  saveAgent(
    {
      id: randomUUID(),
      name: "Moss",
      character: "moss",
      instructions: "Desktop test only",
      model: "fixture",
    },
    directory,
  ),
);
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
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(lifetime);
  for (const socket of clients) socket.destroy();
  await new Promise<void>((resolve) => vnc.close(() => resolve()));
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise<void>((resolve) =>
      server.once("exit", () => resolve()),
    );
    server.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGKILL");
      await exited;
    }
  }
  rmSync(directory, { recursive: true, force: true });
}
const lifetime = setTimeout(
  () => {
    void stop();
  },
  20 * 60 * 1000,
);
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});
server.once("exit", () => {
  void stop();
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Desktop fixture server exited.");
    try {
      ready = (await fetch(`${origin}/api/health`)).ok;
    } catch {
      /* starting */
    }
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error("Desktop fixture failed to start.");
  console.log(
    "Native desktop fixture ready at http://127.0.0.1:4499 (20-minute lifetime).",
  );
} catch (error) {
  await stop();
  throw error;
}
