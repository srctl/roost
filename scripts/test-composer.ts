import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { type Browser, chromium } from "playwright";
import { createServer } from "vite";

// No TanStack/Nitro server or worker: callbacks and uploads are local test doubles.
const server = await createServer({
  configFile: false,
  resolve: {
    alias: [
      {
        find: "../../features/settings/preferences",
        replacement: resolve("tests/fixtures/composer/preferences.ts"),
      },
    ],
  },
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
let browser: Browser | undefined;
try {
  browser = await chromium.launch({
    executablePath: process.env.COMPOSER_CHROME_PATH || undefined,
  });
  const artifacts = process.env.COMPOSER_ARTIFACTS;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  for (const mode of ["desktop", "mobile", "standalone"] as const) {
    const mobile = mode !== "desktop";
    const context = await browser.newContext({
      viewport: { width: mobile ? 390 : 1280, height: 844 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: "reduce",
    });
    if (mode === "standalone") {
      await context.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          const result = original(query);
          if (query === "(display-mode: standalone)")
            Object.defineProperty(result, "matches", { value: true });
          return result;
        };
      });
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.resolvedUrls!.local[0]}tests/fixtures/composer/`);
    const input = page.getByRole("textbox", { name: "Message Fixture" });
    const send = page.getByRole("button", {
      name: "Send message",
      exact: true,
    });
    const stop = page.getByRole("button", {
      name: "Stop response",
      exact: true,
    });
    await input.waitFor();
    await page.waitForFunction(
      () => !document.querySelector("textarea")?.disabled,
    );
    const controls = async (sends: number, stops: number) => {
      await page.waitForFunction(
        ({ sends, stops }) =>
          document.querySelectorAll('[aria-label="Send message"]').length ===
            sends &&
          document.querySelectorAll('[aria-label="Stop response"]').length ===
            stops,
        { sends, stops },
      );
    };
    const size = async (label: string) => {
      const button = page.getByRole("button", { name: label, exact: true });
      const dimensions = await button.evaluate((element) => {
        const css = getComputedStyle(element);
        return {
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
          border: Number.parseFloat(css.borderTopWidth),
          clip: css.backgroundClip,
        };
      });
      assert.deepEqual(dimensions, {
        width: mobile ? 44 : 28,
        height: mobile ? 44 : 28,
        border: mobile ? 4 : 0,
        clip: "padding-box",
      });
      if (artifacts)
        await page.screenshot({
          path: resolve(artifacts, `${mode}-${label.split(" ")[0]}.png`),
        });
    };
    await controls(0, 1);
    await size("Stop response");
    await input.fill(" \n\t ");
    await controls(0, 1);
    await input.press("Enter");
    assert.equal(await page.evaluate(() => window.composerTest.sent.length), 0);
    await input.fill("  follow up  ");
    await controls(1, 0);
    await size("Send message");
    await input.fill("");
    await controls(0, 1);
    await input.fill("  follow up  ");
    if (mobile) {
      // The transparent outer rim remains clickable.
      await send.tap({ position: { x: 2, y: 22 } });
    } else await send.click();
    assert.equal(await send.isDisabled(), true);
    await controls(1, 0);
    if (mode === "standalone")
      assert.equal(
        await input.evaluate((element) => element === document.activeElement),
        false,
      );
    await input.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.composerTest.sent), [
      { text: "follow up", files: [] },
    ]);
    await page.evaluate(() => window.composerTest.finish?.(true));
    await controls(0, 1);
    assert.equal(await input.inputValue(), "");
    if (mobile) await stop.tap({ position: { x: 2, y: 22 } });
    else {
      await stop.focus();
      await stop.press("Enter");
    }
    await controls(1, 0);
    assert.equal(await page.evaluate(() => window.composerTest.stops), 1);
    assert.equal(await send.isDisabled(), true);

    await input.fill("idle send");
    await input.press("Shift+Enter");
    assert.equal(await input.inputValue(), "idle send\n");
    await input.press("Enter");
    assert.equal(
      await page.evaluate(() => window.composerTest.sent.at(-1)?.text),
      "idle send",
    );
    await page.evaluate(() => window.composerTest.finish?.(true));
    await page.waitForFunction(
      () => document.querySelector("textarea")?.value === "",
    );
    await controls(1, 0);
    assert.equal(await send.isDisabled(), true);

    await page.evaluate(() => window.composerTest.setBusy(true));
    await input.fill("retry me");
    await input.press("Enter");
    await page.evaluate(() => window.composerTest.finish?.(false));
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>(
          '[aria-label="Send message"]',
        )?.disabled,
    );
    assert.equal(await input.inputValue(), "retry me");
    await controls(1, 0);
    await send.click();
    await input.fill("new draft during send");
    await page.evaluate(() => window.composerTest.finish?.(true));
    await controls(1, 0);
    assert.equal(await input.inputValue(), "new draft during send");
    await page.evaluate(() => window.composerTest.setLoading(true));
    assert.equal(await send.isDisabled(), true);
    await input.fill("");
    await controls(0, 1);
    assert.equal(await stop.isDisabled(), false);
    await page.evaluate(() => window.composerTest.setLoading(false));

    let completeUpload: (() => void) | undefined;
    await page.route("**/api/files", async (route) => {
      await new Promise<void>((done) => {
        completeUpload = done;
      });
      await route.fulfill({
        json: {
          id: "file-1",
          name: "note.txt",
          size: 4,
          mimeType: "text/plain",
        },
      });
    });
    await input.fill("with file");
    await page.locator('input[type="file"]').setInputFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("note"),
    });
    await page.getByText("Uploading…", { exact: true }).waitFor();
    assert.equal(await send.isDisabled(), true);
    await controls(1, 0);
    completeUpload!();
    await page.getByRole("list", { name: "Attached files" }).waitFor();
    await input.fill(" \t ");
    await controls(1, 1);
    await send.click();
    assert.deepEqual(
      await page.evaluate(() => window.composerTest.sent.at(-1)),
      {
        text: "",
        files: [
          { id: "file-1", name: "note.txt", size: 4, mimeType: "text/plain" },
        ],
      },
    );
    await page.evaluate(() => window.composerTest.finish?.(true));
    await controls(0, 1);
    assert.equal(
      await page.getByRole("list", { name: "Attached files" }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${mode}: visibility, send/stop callbacks, draft transitions, guards, attachments, dimensions`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
