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
  console.log(
    "Electron e2e passed: connect, agent selection, isolated workspace, permissions panel, disconnect.",
  );
} finally {
  await application?.close();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
