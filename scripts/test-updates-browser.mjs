/** Run against a disposable development preview. The qualified API responses are
 * fixtures: this verifies rendered browser behavior, not release qualification.
 * PLAYWRIGHT_MODULE may point to an existing Playwright installation. */
import assert from "node:assert/strict";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.UPDATE_TEST_URL ?? "http://127.0.0.1:4191";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))
  throw new Error("Browser harness requires a disposable loopback preview.");
const browser = await chromium.launch({
  ...(process.env.CHROME_BINARY
    ? { executablePath: process.env.CHROME_BINARY }
    : {}),
  args: ["--no-sandbox"],
});
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    let posts = 0,
      cancels = 0,
      offline = false,
      unauthorized = false;
    let acceptedKey;
    const status = {
      capability: {
        code: "supported",
        reason: "Qualified updater fixture.",
        canActivate: true,
      },
      version: "0.1.40",
      latest: {
        id: "a".repeat(64),
        version: "0.1.41",
        notes: "<script>untrusted release notes</script>",
        checkedAt: Date.now(),
        expiresAt: Date.now() + 600000,
      },
      operation: null,
      csrf: "fixture",
      recent: true,
      canCheck: true,
      enrolled: true,
    };
    await context.route("**/api/updates**", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        if (request.url().endsWith("/cancel")) {
          cancels++;
          status.operation.phase = "cancelled";
          status.operation.cancellable = false;
          return route.fulfill({ json: { operation: status.operation } });
        }
        posts++;
        acceptedKey = request.postDataJSON().key;
        return route.abort("connectionreset"); // acceptance response was lost
      }
      if (offline) return route.abort("connectionrefused");
      if (unauthorized)
        return route.fulfill({ status: 401, json: { error: "Sign in" } });
      return route.fulfill({ json: status });
    });
    const page = await context.newPage();
    const open = async (p) => {
      await p.goto(`${base}/settings?group=updates`);
      await p.getByRole("heading", { name: "Software updates" }).waitFor();
      await p.waitForTimeout(2500);
    };
    await open(page);
    await page
      .getByRole("button", { name: "Update to 0.1.41", exact: true })
      .click();
    if (process.env.UPDATE_SCREENSHOT_DIR) {
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${process.env.UPDATE_SCREENSHOT_DIR}/confirmation-fixture-${viewport.width === 390 ? "mobile" : "desktop"}.png`,
        fullPage: true,
      });
    }
    const confirm = page.getByRole("button", {
      name: "Confirm update and outage",
    });
    assert.equal(await confirm.isDisabled(), true);
    await page.getByLabel("Type 0.1.41 to confirm").fill("0.1.40");
    assert.equal(await confirm.isDisabled(), true);
    await page.getByLabel("Type 0.1.41 to confirm").press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "Update to 0.1.41", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page
      .getByRole("button", { name: "Update to 0.1.41", exact: true })
      .click();
    await page.getByLabel("Type 0.1.41 to confirm").fill("0.1.41");
    await confirm.click();
    await page
      .getByText("Acceptance response was lost or refused.", { exact: false })
      .waitFor();
    assert.equal(posts, 1);
    await page.reload();
    await page
      .getByText("Checking an earlier confirmation.", { exact: false })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Update to 0.1.41", exact: true })
        .isDisabled(),
      true,
    );
    const other = await context.newPage();
    await open(other);
    assert.equal(
      await other
        .getByRole("button", { name: "Update to 0.1.41", exact: true })
        .isDisabled(),
      true,
    );
    status.operation = {
      id: "11111111-1111-4111-8111-111111111111",
      requestKey: acceptedKey,
      phase: "draining",
      version: "0.1.41",
      previous: "0.1.40",
      updatedAt: Date.now(),
      cancellable: true,
      committed: false,
      blockers: ["A coding worker is uncertain."],
    };
    await page
      .getByRole("button", { name: "Cancel update", exact: true })
      .waitFor();
    await other
      .getByRole("button", { name: "Cancel update", exact: true })
      .waitFor();
    offline = true;
    await page
      .getByText("Reconnecting…", { exact: false })
      .waitFor({ timeout: 15000 });
    assert.equal(posts, 1);
    offline = false;
    await page
      .getByRole("button", { name: "Cancel update", exact: true })
      .click();
    await page
      .getByText("Update cancelled", { exact: true })
      .waitFor({ timeout: 30000 });
    assert.equal(cancels, 1);
    assert.equal(posts, 1);
    unauthorized = true;
    await page
      .getByText("Sign in again to read the durable update result.", {
        exact: false,
      })
      .waitFor({ timeout: 15000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await context.close();
    console.log(
      `PASS rendered update confirmation/lost response/reload/two tabs/cancel/reauth ${viewport.width}x${viewport.height}`,
    );
  }
} finally {
  await browser.close();
}
