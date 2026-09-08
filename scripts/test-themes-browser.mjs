// Run against an isolated Roost instance; see docs/custom-themes.md.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const origin = process.env.THEME_TEST_ORIGIN ?? "http://localhost:4318";
const output = resolve(process.env.THEME_EVIDENCE_DIR ?? "docs/theme-evidence");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BINARY,
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
const names = {
  default: "Default",
  "rose-pine": "Rosé Pine",
  carbonfox: "Carbonfox",
  catppuccin: "Catppuccin",
};
const backgrounds = {
  default: ["rgb(255, 255, 255)", "rgb(32, 34, 30)"],
  "rose-pine": ["rgb(250, 244, 237)", "rgb(25, 23, 36)"],
  carbonfox: ["rgb(242, 244, 248)", "rgb(22, 22, 22)"],
  catppuccin: ["rgb(239, 241, 245)", "rgb(30, 30, 46)"],
};
const themeCookie = (value) => ({ name: "roost.theme", value, url: origin });
const background = (page) =>
  page.locator("html").evaluate((el) => getComputedStyle(el).backgroundColor);
const checkedTheme = (page) => page.locator("html").getAttribute("data-theme");
async function ready(page) {
  await page
    .getByRole("heading", { name: "Color theme", exact: true })
    .waitFor();
  await page.waitForTimeout(200);
}
try {
  for (const [size, viewport] of Object.entries({
    desktop: { width: 1440, height: 1100 },
    mobile: { width: 390, height: 844 },
  })) {
    const context = await browser.newContext({
      viewport,
      colorScheme: "light",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    for (const [preset, name] of Object.entries(names)) {
      for (const [index, mode] of ["light", "dark"].entries()) {
        await context.addCookies([themeCookie(`${preset}:${mode}`)]);
        await page.goto(`${origin}/settings`);
        await ready(page);
        await page
          .getByRole("heading", { name: "Settings", exact: true })
          .scrollIntoViewIfNeeded();
        assert.equal(await background(page), backgrounds[preset][index]);
        assert.equal(
          await page
            .getByRole("radio", { name: new RegExp(`^${name}`) })
            .getAttribute("aria-checked"),
          "true",
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${size}/${preset}/${mode} overflow`,
        );
        const section = page.getByRole("region", { name: "Color theme" });
        const box = await section.boundingBox();
        assert.ok(
          box.x >= 0 && box.x + box.width <= viewport.width,
          "Theme cards fit viewport",
        );
        assert.equal(
          await page
            .locator("html")
            .evaluate((el) => getComputedStyle(el).colorScheme),
          mode,
        );
        await page.screenshot({
          path: resolve(output, `${size}-${preset}-${mode}.png`),
        });
        if (size === "desktop") {
          await page
            .getByRole("heading", { name: "Preview", exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(output, `conversation-${preset}-${mode}.png`),
          });
        }
      }
    }
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/settings`);
  await ready(page);
  await page.getByRole("radio", { name: /^Rosé Pine/ }).click();
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  assert.equal(await background(page), backgrounds["rose-pine"][1]);
  assert.equal(
    (await context.cookies()).find((c) => c.name === "roost.theme"),
    undefined,
    "Preview must not persist",
  );
  await page.getByRole("button", { name: "Cancel preview" }).click();
  assert.equal(await checkedTheme(page), "default");
  await page.getByRole("radio", { name: /^Catppuccin/ }).click();
  await page.reload();
  await ready(page);
  assert.equal(await checkedTheme(page), "default", "Reload discards preview");
  await page.getByRole("radio", { name: /^Carbonfox/ }).click();
  await page.getByRole("button", { name: "Save theme" }).click();
  assert.equal(
    (await context.cookies()).find((c) => c.name === "roost.theme").value,
    "carbonfox:system",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await background(page), backgrounds.carbonfox[1]);
  await page.reload();
  await ready(page);
  assert.equal(await checkedTheme(page), "carbonfox");
  await page.getByRole("radio", { name: /^Rosé Pine/ }).click();
  // SPA navigation must trigger preview cleanup, without requiring a reload.
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "roost", exact: true })
    .click();
  assert.equal(await checkedTheme(page), "carbonfox");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await ready(page);
  const first = page.getByRole("radio", { name: /^Default/ });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await checkedTheme(page),
    "rose-pine",
    "Radio group supports keyboard navigation",
  );
  assert.equal(await page.locator(":focus").getAttribute("role"), "radio");
  await page.evaluate(() =>
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get() {
        return "";
      },
      set() {
        throw new Error("Blocked storage");
      },
    }),
  );
  await page.getByRole("button", { name: "Save theme" }).click();
  assert.match(
    await page.getByRole("alert").innerText(),
    /Could not save your theme/,
  );
  await page.getByRole("button", { name: "Cancel preview" }).click();
  assert.equal(await checkedTheme(page), "carbonfox");
  await context.close();
  // A saved palette must render correctly even before JavaScript/hydration.
  for (const mode of ["light", "dark"]) {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      colorScheme: mode,
    });
    await context.addCookies([themeCookie("catppuccin:system")]);
    const page = await context.newPage();
    await page.goto(`${origin}/settings`);
    assert.equal(
      await background(page),
      backgrounds.catppuccin[mode === "dark" ? 1 : 0],
    );
    assert.equal(await checkedTheme(page), "catppuccin");
    await context.close();
  }
  assert.deepEqual(
    errors,
    [],
    "No hydration errors or uncaught browser exceptions",
  );
  console.log(
    "PASS: 16 desktop/mobile palette views, 8 conversation views, preview/cancel/save/reload/navigation, System changes, keyboard, blocked storage, SSR first paint.",
  );
} finally {
  await browser.close();
}
