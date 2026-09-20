import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { type Browser, chromium } from "playwright";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { uploadAttachment } from "../../src/server/files/store.server";
import { putMessage } from "../../src/server/runs/timeline.server";

// Run after the production build; owns a separate disposable store and port.
const directory = mkdtempSync(join(tmpdir(), "roost-browser-images-"));
process.env.ROOST_DATA_DIR = directory;
const agentId = randomUUID();
await Effect.runPromise(
  saveAgent({
    id: agentId,
    name: "Image preview fixture",
    instructions: "Local image preview verification",
    character: "moss",
    model: "fixture",
  }),
);
const image = await Effect.runPromise(
  uploadAttachment({
    agentId,
    name: "Garden.png",
    mimeType: "image/png",
    bytes: readFileSync(
      resolve(
        "../ios/Roost/Resources/Assets.xcassets/AppIcon.appiconset/Icon.png",
      ),
    ),
  }),
);
const document = await Effect.runPromise(
  uploadAttachment({
    agentId,
    name: "Garden notes.txt",
    mimeType: "text/plain",
    bytes: Buffer.from("Water the herbs."),
  }),
);
const broken = await Effect.runPromise(
  uploadAttachment({
    agentId,
    name: "Damaged.png",
    mimeType: "image/png",
    bytes: Buffer.from("Not an image"),
  }),
);
await Effect.runPromise(
  withAgentStore((db) => {
    db.prepare("INSERT INTO timeline_imports VALUES (?)").run(agentId);
    putMessage(db, agentId, {
      id: randomUUID(),
      role: "assistant",
      text: "Your garden picture and notes.",
      files: [
        image,
        document,
        broken,
        {
          ...image,
          id: randomUUID(),
          name: "Remote.png",
          url: "https://external.invalid/tracker.png",
        },
      ],
    });
  }),
);
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>((done) => probe.close(() => done()));
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env: {
    ...process.env,
    ROOST_DATA_DIR: directory,
    HOST: "127.0.0.1",
    PORT: String(port),
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (data) => {
  logs += data;
});
server.stderr.on("data", (data) => {
  logs += data;
});
const base = `http://127.0.0.1:${port}`;
let browser: Browser | undefined;
try {
  browser = await chromium.launch({
    executablePath: process.env.ROOST_TEST_CHROME || undefined,
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await fetch(`${base}/api/health`)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    if (attempt === 99) throw new Error(logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  mkdirSync(resolve("../../output/playwright"), { recursive: true });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width < 700,
      reducedMotion: "reduce",
    });
    await context.addCookies([
      { name: "roost.responseStyle", value: "messages", url: base },
    ]);
    const page = await context.newPage();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    let imageUnavailable = true;
    await page.route(
      (url) =>
        url.pathname === "/api/files" &&
        url.searchParams.get("id") === image.id,
      (route) =>
        imageUnavailable
          ? route.fulfill({
              status: 503,
              contentType: "text/plain",
              body: "Temporarily unavailable",
            })
          : route.continue(),
    );
    await page.goto(`${base}/agents/${agentId}`);
    const preview = page.getByRole("button", {
      name: "Open image, Garden.png",
      exact: true,
    });
    await preview.waitFor();
    await preview.getByText("Preview unavailable · Open image").waitFor();
    imageUnavailable = false;
    await preview.click();
    const dialog = page.getByRole("dialog", { name: "Garden.png" });
    await dialog.waitFor();
    await dialog
      .getByRole("img", { name: "Garden.png" })
      .evaluate((image) => (image as HTMLImageElement).decode());
    assert.equal(
      await dialog
        .getByRole("link", { name: "Download" })
        .getAttribute("download"),
      "Garden.png",
    );
    await page.screenshot({
      path: resolve(`../../output/playwright/image-viewer-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await preview
      .locator("img")
      .evaluate((image) => (image as HTMLImageElement).decode());
    assert.equal(
      await preview.evaluate((element) => element === document.activeElement),
      true,
    );
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Garden notes.txt" }).click();
    assert.equal((await download).suggestedFilename(), "Garden notes.txt");
    const brokenPreview = page.getByRole("button", {
      name: "Open image, Damaged.png",
    });
    await brokenPreview.scrollIntoViewIfNeeded();
    await brokenPreview.getByText("Preview unavailable · Open image").waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Damaged.png" })
        .getAttribute("download"),
      "Damaged.png",
    );
    assert.equal(
      requests.some((url) => url.includes("external.invalid")),
      false,
    );
    const picker = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Attach files", exact: true })
      .click();
    await (await picker).setFiles({
      name: "Composer.png",
      mimeType: "image/png",
      buffer: readFileSync(
        resolve(
          "../ios/Roost/Resources/Assets.xcassets/AppIcon.appiconset/Icon.png",
        ),
      ),
    });
    const attached = page.getByRole("list", { name: "Attached files" });
    const thumbnail = attached.getByRole("button", {
      name: "Open image, Composer.png",
    });
    await thumbnail.waitFor();
    await thumbnail.click();
    await page.getByRole("dialog", { name: "Composer.png" }).waitFor();
    await page.getByRole("button", { name: "Close image" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: resolve(`../../output/playwright/images-${width}.png`),
    });
    await attached.getByRole("button", { name: "Remove Composer.png" }).click();
    await attached.waitFor({ state: "hidden" });
    await context.close();
    console.log(
      `Image previews, viewer, focus, download, fallback, and composer passed at ${width}px`,
    );
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
  rmSync(directory, { recursive: true, force: true });
}
