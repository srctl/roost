/** Real native-auth acceptance against an explicitly selected disposable guest.
 * The runner supplies a private TLS release fixture, enrolled systemd helper,
 * inert draft agent, and a Chromium virtual-authenticator credential file.
 * No API responses, authentication, artifact validation, or services are mocked. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [version, outcome, runningVersion] = process.argv.slice(2);
const origin = process.env.UPDATE_TEST_ORIGIN;
const credentialsPath = process.env.UPDATE_TEST_PASSKEYS;
const agent = process.env.UPDATE_TEST_AGENT;
const mobileActivation = process.env.UPDATE_TEST_MOBILE === "yes";
if (
  process.env.UPDATE_TEST_DISPOSABLE !== "yes" ||
  !origin ||
  new URL(origin).hostname !== "localhost" ||
  !credentialsPath ||
  !agent ||
  !/^\d+\.\d+\.\d+$/.test(version ?? "") ||
  !["succeeded", "rolled-back", "cancelled", "deferred"].includes(outcome) ||
  !runningVersion
)
  throw new Error(
    "Select an explicitly disposable localhost guest, test passkeys, agent, candidate, outcome and running version.",
  );
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BINARY,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
context.setDefaultTimeout(60000);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
for (const credential of JSON.parse(await readFile(credentialsPath, "utf8"))
  .credentials)
  await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
const saveAuthenticator = async () =>
  writeFile(
    credentialsPath,
    JSON.stringify(
      await cdp.send("WebAuthn.getCredentials", { authenticatorId }),
    ),
    { mode: 0o600 },
  );
const screenshot = async (label) => {
  if (process.env.UPDATE_SCREENSHOT_DIR)
    await page.screenshot({
      path: join(process.env.UPDATE_SCREENSHOT_DIR, `${label}.png`),
      fullPage: true,
    });
};
const draftText = "Unsent native update acceptance draft";
let submissions = 0;
let updatePosts = 0;
context.on("request", (request) => {
  if (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/updates"
  )
    updatePosts++;
  if (request.method() === "POST" && request.postData()?.includes(draftText))
    submissions++;
});
try {
  await page.goto(`${origin}/auth`);
  await page
    .getByRole("button", { name: "Sign in with a passkey", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/");
  await saveAuthenticator();
  console.log("Native passkey authenticated");
  const draft = await context.newPage();
  await draft.goto(`${origin}/agents/${agent}`);
  await draft.locator("textarea").fill(draftText);
  await draft.waitForTimeout(500);
  const observer = await context.newPage();
  await observer.goto(`${origin}/settings?group=updates`);
  await page.goto(`${origin}/settings?group=updates`);
  await page
    .getByRole("button", { name: "Check for updates", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Update to ${version}`, exact: true })
    .click();
  const confirmationInput = page.getByRole("textbox", {
    name: `Type ${version} to confirm`,
  });
  assert.equal(
    await confirmationInput.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  await confirmationInput.press("Escape");
  const trigger = page.getByRole("button", {
    name: `Update to ${version}`,
    exact: true,
  });
  assert.equal(
    await trigger.evaluate((element) => element === document.activeElement),
    true,
  );
  await trigger.press("Enter");
  const tree = await cdp.send("Accessibility.getFullAXTree");
  assert.ok(
    tree.nodes.some(
      (node) =>
        node.role?.value === "textbox" &&
        node.name?.value === `Type ${version} to confirm`,
    ),
  );
  await page
    .getByRole("textbox", { name: `Type ${version} to confirm` })
    .fill(version);
  await screenshot("native-confirm-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("native-confirm-mobile");
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (!mobileActivation)
    await page.setViewportSize({ width: 1440, height: 1000 });
  let accepted;
  // Deliver the real POST, then lose only its response. Polling must discover
  // the durable operation without automatically submitting another mutation.
  await page.route("**/api/updates", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    assert.equal(accepted, undefined, "Acceptance must not be submitted twice");
    const response = await route.fetch();
    assert.equal(response.status(), 202);
    accepted = (await response.json()).operation;
    console.log("Durable acceptance", accepted.id);
    await route.abort("connectionreset");
  });
  await page
    .getByRole("button", { name: "Confirm update and outage", exact: true })
    .click();
  const observed = new Set();
  let cancellationSent = false;
  let result;
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    try {
      const status = await page.evaluate(async () => {
        const response = await fetch("/api/updates");
        return response.ok ? response.json() : { http: response.status };
      });
      if (status.http) observed.add(`HTTP ${status.http}`);
      const phase = status.operation?.phase;
      if (
        accepted &&
        status.operation?.id === accepted.id &&
        phase &&
        !observed.has(phase)
      ) {
        observed.add(phase);
        console.log("Observed phase", phase);
      }
      if (
        outcome === "cancelled" &&
        phase === "draining" &&
        !cancellationSent
      ) {
        await page
          .getByRole("button", { name: "Cancel update", exact: true })
          .click();
        cancellationSent = true;
      }
      if (
        accepted &&
        status.operation?.id === accepted.id &&
        [
          "succeeded",
          "rolled-back",
          "failed",
          "deferred",
          "cancelled",
          "manual-recovery",
        ].includes(phase)
      ) {
        result = status;
        break;
      }
    } catch {
      observed.add("disconnected");
    }
  }
  assert.equal(
    result?.operation?.phase,
    outcome,
    JSON.stringify({
      version: result?.version,
      capability: result?.capability,
      operation: result?.operation,
    }),
  );
  assert.equal(result.version, runningVersion);
  assert.equal(result.operation.id, accepted?.id);
  await draft.reload();
  await draft.waitForFunction(
    (text) => document.querySelector("textarea")?.value === text,
    draftText,
  );
  await observer.reload();
  await observer
    .getByRole("heading", { name: "Software updates", exact: true })
    .waitFor();
  const observerResult = await observer.evaluate(async () =>
    (await fetch("/api/updates")).json(),
  );
  assert.equal(observerResult.operation.id, accepted.id);
  await observer
    .getByRole("status")
    .filter({
      hasText: {
        succeeded: "Update succeeded",
        "rolled-back": "Previous version and data restored",
        cancelled: "Update cancelled",
        deferred: "Update deferred",
      }[outcome],
    })
    .waitFor();
  // A stale shell can request an unavailable module after restart. Lose one
  // real module load, then recover with a browser reload; storage must retain
  // drafts and the durable request key must never become a second POST.
  await page.reload();
  await page
    .getByRole("heading", { name: "Software updates", exact: true })
    .waitFor();
  const script = await page
    .locator('script[type="module"][src]')
    .first()
    .getAttribute("src");
  assert.ok(script);
  const asset = new URL(script, origin).href;
  assert.ok(new URL(asset).pathname.startsWith("/assets/"));
  // The real service worker may already hold the immutable module. Bypass its
  // cache only for this explicit missing-network-asset injection, then restore
  // normal service-worker behavior for recovery.
  await cdp.send("Network.enable");
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  let missingAsset = false;
  await page.route(asset, async (route) => {
    missingAsset = true;
    await route.abort("failed");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(missingAsset, true);
  await page.unroute(asset);
  await cdp.send("Network.setBypassServiceWorker", { bypass: false });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await page.reload();
  await page
    .getByRole("heading", { name: "Software updates", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Reload versioned app assets", exact: true })
    .waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(1000);
  await screenshot("native-result-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("native-result-mobile");
  await draft.setViewportSize({ width: 390, height: 844 });
  await draft.reload();
  await draft.waitForFunction(
    (text) => document.querySelector("textarea")?.value === text,
    draftText,
  );
  await page.goto(`${origin}/auth?updates=1`);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign in with a passkey", exact: true })
    .click();
  await page.waitForURL(
    (url) =>
      url.pathname === "/settings" &&
      url.searchParams.get("group") === "updates",
  );
  await saveAuthenticator();
  const authenticated = await page.evaluate(async () =>
    (await fetch("/api/updates")).json(),
  );
  assert.equal(authenticated.recent, true);
  const recovered = await page.evaluate(
    async (key) =>
      (await fetch(`/api/updates?key=${encodeURIComponent(key)}`)).json(),
    accepted.requestKey,
  );
  assert.equal(recovered.operation.id, accepted.id);
  await draft.reload();
  await draft.waitForFunction(
    (text) => document.querySelector("textarea")?.value === text,
    draftText,
  );
  await draft.close();
  const reopened = await context.newPage();
  await reopened.goto(`${origin}/agents/${agent}`);
  await reopened.waitForFunction(
    (text) => document.querySelector("textarea")?.value === text,
    draftText,
  );
  await reopened.goto(`${origin}/settings?group=updates`);
  await reopened
    .getByRole("button", { name: "Reload versioned app assets", exact: true })
    .waitFor();
  assert.equal(submissions, 0);
  assert.equal(updatePosts, 1);
  console.log(
    JSON.stringify({
      version,
      outcome,
      operation: result.operation.id,
      observed: [...observed],
      nativePasskey: true,
      reauthenticated: true,
      returnedToUpdates: true,
      retainedDraft: true,
      submissions,
      multiTab: true,
      mobile: true,
      mobileActivation,
      keyboardAndAccessibilityTree: true,
      missingAssetReload: true,
      closedTabDraft: true,
      updatePosts,
    }),
  );
} finally {
  await saveAuthenticator();
  await browser.close();
}
