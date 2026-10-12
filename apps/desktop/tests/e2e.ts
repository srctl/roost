import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const root = mkdtempSync(join(tmpdir(), "roost-desktop-e2e-"));
const token = `roost_mobile_${"a".repeat(43)}`;
const agentId = randomUUID();
const lease = randomUUID();
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/api/mobile/v1/")) {
    res.setHeader("Content-Type", "text/html");
    res.end("<h1>Roost fixture workspace</h1>");
    return;
  }
  assert.equal(req.headers.authorization, `Bearer ${token}`);
  res.setHeader("Content-Type", "application/json");
  if (req.url.endsWith("/agents"))
    res.end(JSON.stringify([{ id: agentId, name: "Moss" }]));
  else if (req.url.endsWith("/session"))
    res.end(JSON.stringify({ apiVersion: 1 }));
  else if (req.url.endsWith("/connect"))
    res.end(JSON.stringify({ lease, protocolVersion: 1 }));
  else if (req.url.endsWith("/poll")) res.end(JSON.stringify({ requests: [] }));
  else res.end("{}");
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address !== "string");
let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  application = await electron.launch({
    executablePath: process.env.ROOST_DESKTOP_EXECUTABLE,
    args: process.env.ROOST_DESKTOP_EXECUTABLE ? [] : [resolve(".")],
    env: { ...process.env, ROOST_DESKTOP_TEST_DATA_DIR: root },
    timeout: 30000,
  });
  // Fake credentials use an isolated test store. Avoid real Keychain prompts
  // when exercising ad-hoc signed packages with changing code identities.
  await application.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = (value) => Buffer.from(`fixture:${value}`);
    safeStorage.decryptString = (value) => value.toString().slice(8);
  });
  const page = await application.firstWindow();
  assert.equal(
    await application.evaluate(({ app, nativeImage }) =>
      nativeImage.createFromPath(`${app.getAppPath()}/dist/tray.png`).isEmpty(),
    ),
    false,
  );
  await page
    .getByRole("heading", { name: "Connect this Mac to Roost" })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => typeof (window as unknown as { require?: unknown }).require,
    ),
    "undefined",
  );
  await page.locator("#manual-connection summary").click();
  await page.locator("#origin").fill(`http://127.0.0.1:${address.port}`);
  await page.locator("#token").fill(token);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  try {
    await page.locator("#panel").waitFor({ state: "hidden", timeout: 10000 });
  } catch (error) {
    console.error({
      status: await page.locator("#status").textContent(),
      error: await page.locator("#error").textContent(),
      panel: await page.locator("#panel").evaluate((element) => ({
        hidden: element.hasAttribute("hidden"),
        display: getComputedStyle(element).display,
      })),
    });
    throw error;
  }
  await page.locator("#status").filter({ hasText: "Connected" }).waitFor();
  await page.getByRole("button", { name: "Companion", exact: true }).click();
  await page.locator("#agent").selectOption(agentId);
  await page
    .getByRole("button", { name: "Choose conversations" })
    .waitFor({ state: "visible" });
  assert.equal(await page.locator("#start-computer").isEnabled(), true);
  assert.equal(await page.locator("#stop").isVisible(), false);
  // Simulate OS consent only inside this disposable Electron process. The
  // fixture never sends capture/input requests and no real permission changes.
  await application.evaluate(({ systemPreferences, Notification }) => {
    systemPreferences.isTrustedAccessibilityClient = () => true;
    Notification.prototype.show = () => {};
  });
  await page.getByRole("button", { name: "Enable computer access" }).click();
  await page.locator("#stop").waitFor({ state: "visible" });
  assert.equal(await page.locator("#agent").isEnabled(), false);
  const deniedGrant = await page.evaluate(async (id) => {
    const bridge = (
      window as unknown as {
        roostDesktop: {
          grants: (id: string, chats: unknown[]) => Promise<{ ok: boolean }>;
          startComputer: () => Promise<{ ok: boolean }>;
        };
      }
    ).roostDesktop;
    return [await bridge.grants(id, []), await bridge.startComputer()];
  }, agentId);
  assert.deepEqual(
    deniedGrant.map((result) => result.ok),
    [false, false],
  );
  await page
    .getByRole("button", { name: "Stop computer access", exact: true })
    .click();
  await page.locator("#stop").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#agent").isEnabled(), true);
  const remote = application.windows().find((window) => window !== page);
  assert.ok(remote);
  assert.equal(
    await remote.evaluate(
      () =>
        typeof (window as unknown as { roostDesktop?: unknown }).roostDesktop,
    ),
    "undefined",
  );
  assert.equal(
    await remote.evaluate(
      () => typeof (window as unknown as { require?: unknown }).require,
    ),
    "undefined",
  );
  const output = resolve(
    process.env.ROOST_DESKTOP_SCREENSHOT_DIR || "output/playwright",
  );
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: join(output, "desktop-companion.png") });
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await page.locator("#panel").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Companion", exact: true }).click();
  assert.equal(await page.locator("#agent").inputValue(), "");
  await page.getByRole("button", { name: "Disconnect this Mac" }).click();
  await page.locator("#status").filter({ hasText: "Disconnected" }).waitFor();
  assert.equal(await page.locator("#access").isVisible(), false);
  // tsx names nested functions with this helper when serializing callbacks.
  await application.evaluate("globalThis.__name = (value) => value");
  // Emulate only the external SSH/proxy services. Native API traffic still
  // reaches the disposable HTTP fixture, and no personal credential is used.
  await application.evaluate(({ BrowserWindow }, origin) => {
    const child = process.getBuiltinModule("child_process");
    const token = `roost_mobile_${"a".repeat(43)}`;
    const proxy = `exe_fixture_${"b".repeat(40)}`;
    Object.defineProperty(child, "execFile", {
      value: (
        _file: string,
        args: string[],
        _options: unknown,
        done: (error: Error | null, stdout: string) => void,
      ) => {
        const command = args.slice(7);
        let response: object = {};
        if (command[0] === "ls")
          response = {
            vms: [
              {
                vm_name: "roost-fixture",
                status: "running",
                access: { shell: true },
              },
            ],
          };
        else if (command.includes("generate-api-key"))
          response = {
            token: proxy,
            fingerprint: "SHA256:fixturekey",
            namespace: "v0@roost-fixture.exe.xyz",
            expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          };
        else if (command[0]?.includes("mobile create"))
          response = {
            id: /--id ([a-z0-9-]+)/.exec(command[0])?.[1],
            token,
            expires: Date.now() + 90 * 86400000,
          };
        queueMicrotask(() => done(null, JSON.stringify(response)));
        return {};
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      if (
        typeof input === "string" &&
        input.startsWith("https://roost-fixture.exe.xyz/")
      ) {
        if (
          options?.headers &&
          new Headers(options.headers).get("X-Exedev-Authorization") !==
            `Bearer ${proxy}`
        )
          throw new Error("Missing fixture proxy credential");
        return originalFetch(`${origin}${new URL(input).pathname}`, options);
      }
      return originalFetch(input, options);
    };
    const local = BrowserWindow.getAllWindows()[0];
    if (!local) throw new Error("Fixture window missing");
    const prototype = Object.getPrototypeOf(local.webContents);
    const loadURL = prototype.loadURL;
    Object.defineProperty(prototype, "loadURL", {
      value: function (url: string, options: unknown) {
        return Reflect.apply(loadURL, this, [
          url === "https://roost-fixture.exe.xyz" ? origin : url,
          options,
        ]);
      },
    });
  }, `http://127.0.0.1:${address.port}`);
  await page
    .getByRole("button", { name: "Connect to exe.dev", exact: true })
    .click();
  await page.locator("#exe-vm").selectOption("roost-fixture");
  await page
    .getByRole("button", { name: "Connect to Roost", exact: true })
    .click();
  await page.locator("#panel").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Companion", exact: true }).click();
  assert.equal(
    await page.locator("#connection-origin").textContent(),
    "https://roost-fixture.exe.xyz",
  );
  assert.equal(await page.locator("#token").inputValue(), "");
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await page.locator("#panel").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Companion", exact: true }).click();
  assert.equal(await page.locator("#agent").inputValue(), "");
  await page.getByRole("button", { name: "Disconnect this Mac" }).click();
  await page.locator("#status").filter({ hasText: "Disconnected" }).waitFor();
  await page.screenshot({ path: join(output, "desktop-exedev.png") });
  console.log(
    "Electron e2e passed: manual and exe.dev connections, agent selection, isolated workspace, permissions panel, disconnect.",
  );
} finally {
  await application?.close();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
