import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Use a separately installed Playwright; production dependencies stay unchanged.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
});
const screenshots = fileURLToPath(new URL("./screenshots/", import.meta.url));
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
    page.on("request", (request) => {
      assert.equal(
        new URL(request.url()).hostname,
        "127.0.0.1",
        "No external requests allowed",
      );
      assert.ok(
        !request.url().includes("/api/"),
        "No live API requests allowed",
      );
    });
    await page.goto("http://127.0.0.1:4178/?view=baseline");
    await page
      .getByText("Better view for coding work", { exact: true })
      .click();
    await page.getByText("Worker output", { exact: true }).first().click();
    await page.screenshot({
      path: `${screenshots}before-${name}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "View prototype" }).click();
    await page
      .getByRole("heading", { name: "Coding work", exact: true })
      .waitFor();
    await page.screenshot({
      path: `${screenshots}after-${name}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "No horizontal page overflow",
    );
    await page.getByRole("button", { name: "Replay fixture" }).click();
    await page
      .getByText("Fixture replay complete · no live connection", {
        exact: true,
      })
      .waitFor();
    assert.match(
      await page.locator(".terminal pre").innerText(),
      /No command was executed/,
    );
    await page.getByRole("checkbox", { name: "Follow output" }).uncheck();
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    await page.getByRole("button", { name: "Simulate disconnect" }).click();
    await page
      .getByText(
        "Connection lost · retained snapshot · worker status unknown",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Replay fixture" }).isDisabled(),
      true,
    );
    await page.screenshot({
      path: `${screenshots}disconnected-${name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Restore fixture connection" })
      .click();
    await page.getByRole("button", { name: /Repair export flow/ }).click();
    await page
      .getByText("Approval needed in the worker terminal", { exact: true })
      .waitFor();
    assert.ok(
      !(await page.locator(".terminal pre").innerText()).includes("Sketching"),
      "Replay must not leak across jobs",
    );
    await page.screenshot({
      path: `${screenshots}attention-${name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: /Compact conversation spacing/ })
      .click();
    await page
      .getByText("Coordinator review pending", { exact: true })
      .waitFor();
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile baseline and prototype captures; replay, disconnect/reconnect, follow toggle, job isolation, attention/review states, overflow, no API requests or browser errors.",
  );
} finally {
  await browser.close();
}
