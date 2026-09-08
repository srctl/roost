import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { createServer } from "vite";

// Load the actual Git versions into the same fixture without editing source or
// checking out another worktree. All shared components/styles are unchanged.
const revisions = {
  before: "3f7bae287253e1c4c5449ea78521b2fcc072152d",
  after: "47e0eaae9ad0733f3196cc92d2709f39b240a81f",
};
const component = "src/components/conversation/composer.tsx";
const output = resolve("docs/reviews/composer-controls/comparison");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.COMPOSER_CHROME_PATH || undefined,
});
const evidence = [];
try {
  for (const [version, revision] of Object.entries(revisions)) {
    const source = execFileSync("git", ["show", `${revision}:${component}`], {
      encoding: "utf8",
    });
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
      plugins: [
        {
          name: "composer-evidence-revision",
          enforce: "pre",
          load(id) {
            if (id === resolve(component)) return source;
          },
        },
        stylex.vite({ useCSSLayers: true }),
        react(),
      ],
      server: { host: "127.0.0.1", port: 0 },
    });
    try {
      await server.listen();
      for (const mobile of [false, true]) {
        const mode = mobile ? "mobile" : "desktop";
        const viewport = { width: mobile ? 390 : 1280, height: 844 };
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          isMobile: mobile,
          hasTouch: mobile,
          reducedMotion: "reduce",
          colorScheme: "light",
        });
        try {
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          for (const state of ["running-text", "running-empty"]) {
            await page.goto(
              `${server.resolvedUrls!.local[0]}tests/fixtures/composer/`,
            );
            await page.waitForFunction(
              () => document.querySelector("textarea")?.disabled === false,
            );
            const input = page.getByRole("textbox", {
              name: "Message Fixture",
            });
            await input.fill(state === "running-text" ? "follow up" : "");
            await input.blur();
            await page.mouse.move(0, 0);
            await page.evaluate(() => document.fonts.ready);
            const buttons = await page
              .locator(
                '[aria-label="Send message"], [aria-label="Stop response"]',
              )
              .evaluateAll((elements) =>
                elements.map((element) => {
                  const css = getComputedStyle(element);
                  const rect = element.getBoundingClientRect();
                  return {
                    label: element.getAttribute("aria-label"),
                    width: rect.width,
                    height: rect.height,
                    border: Number.parseFloat(css.borderTopWidth),
                  };
                }),
              );
            assert.deepEqual(
              buttons.map((button) => button.label),
              state === "running-empty"
                ? ["Stop response"]
                : version === "before"
                  ? ["Stop response", "Send message"]
                  : ["Send message"],
            );
            for (const button of buttons) {
              assert.equal(button.width, mobile ? 44 : 28);
              assert.equal(button.height, mobile ? 44 : 28);
              assert.equal(
                button.border,
                mobile && version === "after" ? 4 : 0,
              );
            }
            const file = `${mode}-${state}-${version}.png`;
            await page.screenshot({
              path: resolve(output, file),
              animations: "disabled",
            });
            evidence.push({
              file,
              version,
              revision,
              mode,
              state,
              viewport,
              sourceSha256: createHash("sha256").update(source).digest("hex"),
              buttons,
            });
            console.log(
              `PASS ${file}: actual revision rendered, visibility and dimensions verified`,
            );
          }
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      }
    } finally {
      await server.close();
    }
  }
  await writeFile(
    resolve(output, "capture.json"),
    `${JSON.stringify(
      {
        browser: browser.version(),
        fixture: "tests/fixtures/composer",
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
        focused: false,
        evidence,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser.close();
}
