import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
});
const root = fileURLToPath(new URL(".", import.meta.url));
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1200 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4283/editor.html");
  await page.getByLabel("Load editable concept").waitFor();
  for (const option of ["a", "b", "c"]) {
    for (const size of ["desktop", "mobile"]) {
      const name = `${option}-${size}`;
      const path = `${root}designs/${name}.excalidraw`;
      const original = JSON.parse(readFileSync(path, "utf8"));
      await page.getByLabel("Load editable concept").setInputFiles(path);
      await page.getByText(`${name}.excalidraw`, { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(() => window.researchScene.count()),
        original.elements.length,
      );
      const roundTrip = JSON.parse(
        await page.evaluate(() => window.researchScene.roundTrip()),
      );
      assert.equal(roundTrip.elements.length, original.elements.length);
      assert.deepEqual(
        roundTrip.elements.filter((e) => e.type === "text").map((e) => e.text),
        original.elements.filter((e) => e.type === "text").map((e) => e.text),
      );
      const svg = await page.evaluate(() => window.researchScene.exportSvg());
      assert.ok(svg.includes("<svg") && svg.includes("ROOST"));
      writeFileSync(`${root}designs/${name}.svg`, svg);
      await page.screenshot({ path: `${root}screenshots/editor-${name}.png` });
      const exportPage = await browser.newPage({
        viewport: { width: size === "desktop" ? 1500 : 860, height: 1350 },
      });
      await exportPage.goto(`http://127.0.0.1:4283/designs/${name}.svg`);
      await exportPage
        .locator("svg")
        .screenshot({ path: `${root}designs/${name}.png` });
      await exportPage.close();
      console.log(
        `PASS ${name}: loaded ${original.elements.length} editable elements in Excalidraw 0.18.0; native text preserved through serialization; SVG + rendered PNG exported.`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all six editor loads/round-trips/exports; no browser exceptions.",
  );
} finally {
  await browser.close();
}
