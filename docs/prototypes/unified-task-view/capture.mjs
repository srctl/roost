import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
});
const before = process.argv.includes("--before");
const dir = fileURLToPath(new URL("./screenshots/", import.meta.url));
const errors = [];
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 1100],
    ["mobile", 390, 844],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: "light",
      timezoneId: "UTC",
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1" || url.pathname.startsWith("/api/")) {
        errors.push(`Unexpected request: ${url}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:4182/${before ? "?view=baseline" : ""}`);
    if (before) {
      await page.getByText("Repair export flow", { exact: true }).click();
      await page.getByText("Worker output", { exact: true }).first().click();
    }
    if (!before)
      await page
        .getByRole("complementary")
        .getByRole("heading", { name: "Repair export flow", exact: true })
        .waitFor();
    await page.screenshot({
      path: `${dir}${before ? "before" : "after"}-${name}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "No page overflow",
    );
    if (!before) {
      await page
        .getByRole("button", { name: "Simulate GitHub unavailable" })
        .click();
      await page.getByText("Current result unknown", { exact: true }).waitFor();
      await page.screenshot({
        path: `${dir}stale-${name}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Restore GitHub fixture" })
        .click();
      await page
        .getByRole("button", { name: "Inspect worker terminal ↗", exact: true })
        .click();
      await page
        .getByRole("status")
        .getByText(/No external action was taken/)
        .waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      if (name === "mobile")
        await page.getByRole("button", { name: "← Back to tasks" }).click();
      await page
        .getByRole("button", { name: "Needs you", exact: true })
        .click();
      assert.equal(await page.locator(".task-card").count(), 2);
      await page
        .getByRole("button", { name: /Compact conversation spacing/ })
        .click();
      await page
        .getByRole("complementary")
        .getByText("Human review", { exact: true })
        .waitFor();
      await page.screenshot({
        path: `${dir}review-${name}.png`,
        fullPage: true,
      });
      if (name === "mobile") {
        await page.getByRole("button", { name: "← Back to tasks" }).click();
        assert.equal(
          await page.locator(".task-card").count(),
          2,
          "Back preserves filter",
        );
      }
      await page
        .getByRole("button", { name: "All tasks", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Search tasks" })
        .fill("no-such-fixture");
      await page
        .getByText("No matching tasks. Clear search or choose All tasks.")
        .waitFor();
      await page.getByRole("textbox", { name: "Search tasks" }).fill("offline");
      assert.equal(await page.locator(".task-card").count(), 1);
      await page
        .getByRole("button", { name: /Explain offline recovery/ })
        .click();
      assert.ok(
        await page
          .getByRole("button", { name: "GitHub PR ↗", exact: true })
          .isDisabled(),
      );
      await page.getByRole("button", { name: "Reset fixtures" }).click();
      await page
        .getByRole("button", { name: "Simulate verified handoff" })
        .click();
      assert.match(
        await page.locator(".overview").textContent(),
        /1 \/ 2 task slots held/,
      );
      await page
        .getByRole("status")
        .getByText(/not Done/)
        .waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      assert.ok(
        await page
          .getByRole("button", { name: "Simulate verified handoff" })
          .isDisabled(),
      );
      if (name === "mobile")
        await page.getByRole("button", { name: "← Back to tasks" }).click();
      await page.getByRole("button", { name: /Improve task search/ }).click();
      await page
        .getByRole("complementary")
        .getByText("Human review", { exact: true })
        .waitFor();
      await page.screenshot({
        path: `${dir}handoff-${name}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Reset fixtures" }).click();
      if (name === "mobile") {
        await page.getByRole("button", { name: "← Back to tasks" }).click();
        await page.screenshot({
          path: `${dir}list-mobile.png`,
          fullPage: true,
        });
      }
      for (const [letter, label] of [
        ["b", "B · Status board"],
        ["c", "C · Attention inbox"],
      ]) {
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.screenshot({
          path: `${dir}option-${letter}-${name}.png`,
          fullPage: true,
        });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "Alternative has no page overflow",
        );
      }
      console.log(
        `PASS ${name}: source drilldown, stale GitHub, review != Done, attention filter, empty search, missing PR, verified handoff, slot release, reset, alternative layouts and mobile back navigation.`,
      );
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${before ? "before" : "after"} desktop 1440x1100 / mobile 390x844; no page overflow, browser errors or external/API requests.`,
  );
} finally {
  await browser.close();
}
