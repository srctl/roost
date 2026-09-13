import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

// Explicit existing review URL only. This check edits unsent browser-local
// drafts; it never submits work or changes the job/worker. Native keyboard
// behavior still needs physical-device testing.
const url = process.env.ROOST_JOB_REVIEW_URL;
if (!url) throw new Error("Set ROOST_JOB_REVIEW_URL to an existing job page");
const output =
  process.env.ROOST_BROWSER_EVIDENCE_DIR || "/tmp/roost-job-mobile";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.ROOST_BROWSER_EXECUTABLE,
  headless: true,
});
const results: unknown[] = [];

async function assertControlsVisible(page: Page, bottom: number, top = 0) {
  const send = page.getByRole("button", {
    name: "Send to worker",
    exact: true,
  });
  const box = await send.boundingBox();
  assert.ok(box, "send control is rendered");
  assert.ok(box.height >= 44, "send has a touch-sized target");
  assert.ok(
    box.y >= top && box.y + box.height <= bottom + 1,
    `send must fit visible viewport: ${JSON.stringify(box)}, ${top}..${bottom}`,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "no horizontal overflow",
  );
}

try {
  for (const [width, height] of [
    [320, 740],
    [390, 844],
    [430, 932],
    [1440, 1000],
  ]) {
    const context = await browser.newContext({
      viewport: { width: width!, height: height! },
      hasTouch: width! < 700,
      colorScheme: "light",
      timezoneId: "UTC",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const editor = page.getByRole("textbox", {
      name: "Message worker",
      exact: true,
    });
    try {
      await page.goto(url);
      await editor.waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector<HTMLTextAreaElement>("#job-worker-message")
            ?.disabled,
      );
      await page.screenshot({ path: join(output, `${width}-initial.png`) });
      if (width! < 700) {
        const earlier = page.getByText(/^Earlier messages \(/);
        if (await earlier.count()) {
          assert.equal(
            await earlier.evaluate(
              (node) => (node.parentElement as HTMLDetailsElement).open,
            ),
            false,
            "older history starts collapsed on mobile",
          );
          await earlier.click();
          await page.waitForTimeout(4500);
          assert.equal(
            await earlier.evaluate(
              (node) => (node.parentElement as HTMLDetailsElement).open,
            ),
            true,
            "polling preserves expanded history",
          );
          await earlier.click();
          await page.locator("[data-job-scroll]").evaluate((node) => {
            node.scrollTop = 0;
          });
        }
        const rect = await editor.boundingBox();
        assert.ok(
          rect && rect.y < height! - 150,
          "composer is prominent on the first screen",
        );
        assert.equal(
          await page
            .getByRole("log", { name: "Worker conversation" })
            .evaluate((node) => node.scrollHeight > node.clientHeight + 2),
          false,
          "conversation has no nested scrolling trap",
        );
      }
      const workerResponse = page.locator("[data-worker-response]").first();
      if (await workerResponse.count()) {
        const paragraph = workerResponse.locator("p").first();
        assert.equal(
          await paragraph.evaluate((node) => getComputedStyle(node).whiteSpace),
          "normal",
          "terminal soft wraps reflow in worker paragraphs",
        );
      }
      assert.equal(
        await page
          .getByRole("heading", { name: "Discussion", exact: true })
          .count(),
        0,
        "the conversation does not add a competing title",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Saved feedback", exact: true })
          .isVisible(),
        false,
        "secondary conversations are tucked away",
      );
      const draft =
        "Unsent mobile review draft. " +
        "Keep long instructions readable and the send control reachable. ".repeat(
          28,
        );
      await editor.fill(draft);
      await editor.focus();
      await page.waitForTimeout(4500);
      assert.equal(
        await editor.evaluate((node) => document.activeElement === node),
        true,
        "polling retains typing focus",
      );
      assert.equal(await editor.inputValue(), draft);
      const navigation = page.getByRole("navigation", {
        name: "Other job conversations",
      });
      await navigation.locator("summary").focus();
      await page.keyboard.press("Enter");
      await page
        .getByRole("button", { name: "Saved feedback", exact: true })
        .click();
      await page.waitForFunction(
        () => document.activeElement?.id === "job-feedback",
      );
      await page
        .getByRole("button", { name: "← Worker conversation", exact: true })
        .click();
      await page.waitForFunction(
        (text) =>
          document.querySelector<HTMLTextAreaElement>("#job-worker-message")
            ?.value === text,
        draft,
      );
      await page.waitForFunction(
        () => document.activeElement?.id === "job-worker-message",
      );
      assert.equal(
        await editor.inputValue(),
        draft,
        "switching views preserves the unsent draft",
      );
      await navigation.locator("summary").focus();
      await page.keyboard.press("Enter");
      await page
        .getByRole("button", { name: "Talk to managing agent", exact: true })
        .click();
      await page.waitForFunction(
        () => document.activeElement?.id === "job-agent-heading",
      );
      await page
        .getByRole("button", { name: "← Worker conversation", exact: true })
        .click();
      await page.waitForFunction(
        () => document.activeElement?.id === "job-worker-message",
      );
      assert.equal(
        await editor.inputValue(),
        draft,
        "agent discussion navigation preserves the draft",
      );
      await page.reload();
      await page.waitForFunction(
        (text) =>
          document.querySelector<HTMLTextAreaElement>("#job-worker-message")
            ?.value === text,
        draft,
      );
      await editor.focus();
      if (width! < 700) {
        const shortHeight = width === 320 ? 360 : 420;
        await page.setViewportSize({ width: width!, height: shortHeight });
        await page.waitForTimeout(500);
        await assertControlsVisible(page, shortHeight);
        await page.screenshot({
          path: join(output, `${width}-short-typing.png`),
        });
        await page.setViewportSize({ width: width!, height: height! });
        // Synthetic Safari-style visual viewport resize/pan, not a physical
        // keyboard: layout viewport stays full-sized while the visual view shrinks.
        await page.evaluate(() => {
          const viewport = window.visualViewport!;
          Object.defineProperty(viewport, "height", {
            configurable: true,
            value: 380,
          });
          Object.defineProperty(viewport, "offsetTop", {
            configurable: true,
            value: 24,
          });
          viewport.dispatchEvent(new Event("resize"));
          viewport.dispatchEvent(new Event("scroll"));
        });
        await page.waitForTimeout(500);
        await assertControlsVisible(page, 404, 24);
        assert.equal(
          await editor.evaluate((node) => document.activeElement === node),
          true,
        );
        assert.equal(await editor.inputValue(), draft);
        await page.screenshot({
          path: join(output, `${width}-visual-viewport-emulation.png`),
        });
        await page.evaluate(() => {
          Reflect.deleteProperty(window.visualViewport!, "height");
          Reflect.deleteProperty(window.visualViewport!, "offsetTop");
          window.visualViewport!.dispatchEvent(new Event("resize"));
        });
      }
      assert.deepEqual(errors, [], "no browser exceptions");
      results.push({
        width,
        height,
        passed: true,
        keyboard:
          width! < 700
            ? "short layout + synthetic visual viewport; not physical device"
            : "not emulated",
      });
    } catch (error) {
      await page.screenshot({ path: join(output, `${width}-failure.png`) });
      throw error;
    } finally {
      await context.close();
    }
  }
  writeFileSync(
    join(output, "browser-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    "Job mobile layout, keyboard emulation, draft/reconnect and focus checks passed",
    results,
  );
} finally {
  await browser.close();
}
