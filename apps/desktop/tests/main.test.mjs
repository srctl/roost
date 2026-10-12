import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

// Run the real IPC handlers. Only Electron/OS effects and transport are fixtures.
const compiled = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const require = createRequire(import.meta.url);
const token = `roost_mobile_${"a".repeat(43)}`;
const agentId = randomUUID();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function until(condition) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, "Fixture did not reach the expected step");
    await delay(10);
  }
}
function fixture({
  encrypt = (value) => Buffer.from(value),
  agents,
  poll,
  load,
  ssh,
  authentication,
  keychain,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "roost-main-test-"));
  const handlers = new Map();
  const timers = new Set();
  const intervals = new Set();
  let panel;
  const contents = () =>
    Object.assign(new EventEmitter(), {
      mainFrame: { url: pathToFileURL(join(directory, "panel.html")).href },
      session: {
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        webRequest: { onBeforeSendHeaders() {} },
      },
      send() {},
      close() {},
      setWindowOpenHandler() {},
      async loadURL() {
        await load?.();
      },
    });
  class Window extends EventEmitter {
    webContents = contents();
    contentView = { addChildView() {}, removeChildView() {} };
    constructor() {
      super();
      panel = this;
    }
    isDestroyed() {
      return false;
    }
    async loadFile() {}
    getContentSize() {
      return [1180, 820];
    }
    show() {}
    hide() {}
  }
  class View {
    webContents = contents();
    setVisible() {}
    setBounds() {}
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
  }
  const electron = {
    app: Object.assign(new EventEmitter(), {
      getPath: () => directory,
      setPath() {},
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      isPackaged: true,
      quit() {},
    }),
    BrowserWindow: Window,
    WebContentsView: View,
    Tray,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    safeStorage: {
      isEncryptionAvailable: () => {
        keychain?.();
        return true;
      },
      encryptString: encrypt,
      decryptString: (value) => value.toString(),
    },
    systemPreferences: {
      getMediaAccessStatus: () => "granted",
      isTrustedAccessibilityClient: () => true,
    },
    nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
    globalShortcut: { register() {}, unregisterAll() {} },
    Menu: { buildFromTemplate: (value) => value, setApplicationMenu() {} },
    Notification: class {
      show() {}
    },
    shell: { openExternal() {} },
  };
  const context = vm.createContext({
    Buffer,
    URL,
    Response,
    AbortSignal,
    AbortController,
    console,
    process: { platform: "darwin", env: {} },
    __dirname: directory,
    module: { exports: {} },
    exports: {},
    require: (name) => {
      if (name === "electron") return electron;
      const actual = require(name);
      if (name !== "node:child_process") return actual;
      return {
        ...actual,
        execFile(file, args, options, callback) {
          assert.equal(file, "/usr/bin/ssh");
          Promise.resolve()
            .then(() => ssh?.(args[6], args.slice(7), options.signal))
            .then(
              (result) => callback(null, result || "{}"),
              (error) => callback(error, ""),
            );
          return {};
        },
      };
    },
    async fetch(input, options) {
      authentication?.(options.headers);
      const url = new URL(input);
      const body = options.body ? JSON.parse(options.body) : {};
      if (url.pathname.endsWith("/agents")) {
        await agents?.(url, options.signal);
        return Response.json([{ id: agentId, name: "Fixture" }]);
      }
      if (url.pathname.endsWith("/session"))
        return Response.json({ apiVersion: 1 });
      if (url.pathname.endsWith("/connect"))
        return Response.json({ protocolVersion: 1, lease: randomUUID() });
      if (url.pathname.endsWith("/poll"))
        return (
          (await poll?.(url, body)) ??
          Response.json({ requests: [], activeRequestIds: [] })
        );
      return Response.json({});
    },
    setTimeout(callback, ms) {
      const timer = setTimeout(callback, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout,
    setInterval(callback, ms) {
      const timer = setInterval(callback, ms);
      intervals.add(timer);
      return timer;
    },
  });
  vm.runInContext(compiled.outputFiles[0].text, context);
  return {
    ready: () => Boolean(panel),
    async call(name, ...args) {
      return handlers.get(`desktop:${name}`)(
        { sender: panel.webContents, senderFrame: panel.webContents.mainFrame },
        ...args,
      );
    },
    close() {
      for (const timer of timers) clearTimeout(timer);
      for (const timer of intervals) clearInterval(timer);
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("Disconnect cancels a pending reconnect instead of restoring a workspace", async () => {
  const blocked = deferred(),
    release = deferred();
  let calls = 0;
  const app = fixture({
    agents: async () => {
      if (++calls === 2) {
        blocked.resolve();
        await release.promise;
      }
    },
  });
  try {
    await until(app.ready);
    assert.equal(
      (await app.call("connect", "https://fixture.invalid", token)).ok,
      true,
    );
    const reconnect = app.call("reconnect");
    await blocked.promise;
    assert.equal((await app.call("disconnect")).value.status, "Disconnected");
    release.resolve();
    assert.equal((await reconnect).ok, false);
    assert.equal((await app.call("state")).value.status, "Disconnected");
  } finally {
    release.resolve();
    await app.call("disconnect");
    app.close();
  }
});

test("credential save failure stops its companion before later grants are enabled", async () => {
  let fail = true;
  const abandonedPolls = [];
  const app = fixture({
    encrypt(value) {
      if (fail) throw new Error("Fixture credential failure");
      return Buffer.from(value);
    },
    poll(url, body) {
      if (url.hostname === "abandoned.invalid")
        abandonedPolls.push(body.grants);
    },
  });
  try {
    await until(app.ready);
    assert.equal(
      (await app.call("connect", "https://abandoned.invalid", token)).ok,
      false,
    );
    fail = false;
    assert.equal(
      (await app.call("connect", "https://current.invalid", token)).ok,
      true,
    );
    assert.equal(
      (await app.call("grants", agentId, [{ id: 7, label: "Current only" }]))
        .ok,
      true,
    );
    await delay(1100);
    assert.equal(
      abandonedPolls.length,
      0,
      "Failed connection must not keep polling",
    );
  } finally {
    await app.call("disconnect");
    app.close();
  }
});

test("transport failure while workspace loads never reports Connected or accepts grants", async () => {
  const release = deferred();
  let polls = 0;
  const app = fixture({
    load: () => release.promise,
    poll: () => {
      polls++;
      return Response.json({}, { status: 401 });
    },
  });
  try {
    await until(app.ready);
    const connecting = app.call("connect", "https://fixture.invalid", token);
    await until(() => polls === 1);
    await delay(20);
    release.resolve();
    assert.equal((await connecting).ok, false);
    assert.equal((await app.call("grants", agentId, [])).ok, false);
    assert.equal((await app.call("start-computer")).ok, false);
  } finally {
    release.resolve();
    await app.call("disconnect");
    app.close();
  }
});

test("an older connection finishing cleanup cannot revoke a newer connection's grants", async () => {
  const blocked = deferred(),
    release = deferred();
  const app = fixture({
    agents: async (url) => {
      if (url.hostname === "older.invalid") {
        blocked.resolve();
        await release.promise;
      }
    },
  });
  try {
    await until(app.ready);
    const older = app.call("connect", "https://older.invalid", token);
    await blocked.promise;
    assert.equal(
      (await app.call("connect", "https://newer.invalid", token)).ok,
      true,
    );
    assert.equal(
      (await app.call("grants", agentId, [{ id: 7, label: "Newer only" }])).ok,
      true,
    );
    release.resolve();
    assert.equal((await older).ok, false);
    const current = (await app.call("state")).value;
    assert.equal(current.origin, "https://newer.invalid");
    assert.equal(current.status, "Connected");
    assert.equal(current.grants.chats[0].label, "Newer only");
  } finally {
    release.resolve();
    await app.call("disconnect");
    app.close();
  }
});

test("managed connection IPC shows VM names and status while credentials stay in native requests", async () => {
  const deviceToken = `roost_mobile_${"z".repeat(43)}`;
  const proxyToken = `exe_fixture_${"x".repeat(40)}`;
  const outgoing = [];
  const app = fixture({
    authentication: (headers) => outgoing.push(headers),
    ssh: async (_host, args, signal) => {
      signal?.throwIfAborted();
      if (args[0] === "ls")
        return JSON.stringify({
          vms: [
            {
              vm_name: "roost-dev",
              status: "running",
              access: { shell: true },
            },
          ],
        });
      if (args.includes("generate-api-key"))
        return JSON.stringify({
          token: proxyToken,
          fingerprint: "SHA256:fixturekey",
          namespace: "v0@roost-dev.exe.xyz",
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
      if (args[0].includes("mobile create"))
        return JSON.stringify({
          id: /--id ([a-z0-9-]+)/.exec(args[0])[1],
          token: deviceToken,
          expires: Date.now() + 90 * 86400000,
        });
      return "{}";
    },
  });
  try {
    await until(app.ready);
    const found = await app.call("exe-vms");
    assert.equal(found.value[0].name, "roost-dev");
    const connected = await app.call("exe-connect", "roost-dev");
    assert.equal(connected.ok, true);
    assert.equal(connected.value.status, "Connected");
    assert.ok(
      outgoing.some(
        (headers) =>
          headers.Authorization === `Bearer ${deviceToken}` &&
          headers["X-Exedev-Authorization"] === `Bearer ${proxyToken}`,
      ),
    );
    assert.equal(JSON.stringify(connected).includes(deviceToken), false);
    assert.equal(JSON.stringify(connected).includes(proxyToken), false);
  } finally {
    await app.call("disconnect");
    await delay(30);
    app.close();
  }
});

test("an unfinished managed setup is not saved for a second reconnect to reuse", async () => {
  const blocked = deferred(),
    release = deferred();
  const token = `roost_mobile_${"a".repeat(43)}`;
  const app = fixture({
    load: async () => {
      blocked.resolve();
      await release.promise;
    },
    ssh: async (_host, args) => {
      if (args[0] === "ls")
        return JSON.stringify({
          vms: [
            {
              vm_name: "roost-dev",
              status: "running",
              access: { shell: true },
            },
          ],
        });
      if (args.includes("generate-api-key"))
        return JSON.stringify({
          token: `exe_fixture_${"a".repeat(40)}`,
          fingerprint: "SHA256:fixturekey",
          namespace: "v0@roost-dev.exe.xyz",
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
      if (args[0].includes("mobile create"))
        return JSON.stringify({
          id: /--id ([a-z0-9-]+)/.exec(args[0])[1],
          token,
          expires: Date.now() + 90 * 86400000,
        });
      return "{}";
    },
  });
  let timer;
  try {
    await until(app.ready);
    const connecting = app.call("exe-connect", "roost-dev");
    await blocked.promise;
    const reconnect = await Promise.race([
      app.call("reconnect"),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Pending setup was reused by reconnect")),
          500,
        );
      }),
    ]);
    assert.equal(reconnect.ok, false);
    release.resolve();
    assert.equal((await connecting).ok, true);
  } finally {
    clearTimeout(timer);
    release.resolve();
    await app.call("disconnect");
    await delay(30);
    app.close();
  }
});

test("fresh launch shows the connection panel before accessing credential storage", async () => {
  let prompts = 0;
  const app = fixture({
    keychain: () => {
      prompts++;
    },
  });
  try {
    await until(app.ready);
    assert.equal((await app.call("state")).value.status, "Disconnected");
    assert.equal(prompts, 0);
    assert.equal(
      (await app.call("connect", "https://fixture.invalid", token)).ok,
      true,
    );
    assert.ok(prompts > 0);
  } finally {
    await app.call("disconnect");
    app.close();
  }
});
