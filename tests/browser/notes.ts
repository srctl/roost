import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { chromium } from "playwright";
import type { NoteBlock } from "../../src/features/notes/schema";
import { saveAgent } from "../../src/server/agents/store.server";
import { saveNote } from "../../src/server/notes/store.server";

// Run after `pnpm build`: node --import tsx tests/browser/notes.ts
const directory = mkdtempSync(join(tmpdir(), "roost-browser-notes-"));
const previous = process.env.ROOST_DATA_DIR;
process.env.ROOST_DATA_DIR = directory;
const blocks: NoteBlock[] = Array.from({ length: 12 }, (_, index) => [
  {
    id: randomUUID(),
    type: "heading" as const,
    level: ((index % 3) + 1) as 1 | 2 | 3,
    content: [{ text: `Section ${index + 1}` }],
  },
  ...Array.from({ length: 8 }, () => ({
    id: randomUUID(),
    type: "paragraph" as const,
    content: [
      {
        text: "A shared note records decisions, open questions, and next steps. Keep each section readable and easy to navigate.",
      },
    ],
  })),
]).flat();
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
const browser = await chromium.launch({
  executablePath: process.env.ROOST_TEST_CHROME || undefined,
});
try {
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
  for (const [width, height, hasTouch] of [
    [1440, 1000, false],
    [390, 844, true],
    [320, 700, true],
  ] as const) {
    const id = randomUUID();
    await Effect.runPromise(
      saveAgent({
        id,
        name: "Notes browser fixture",
        instructions: "Local fixture",
        character: "moss",
        model: "fake",
      }),
    );
    await Effect.runPromise(
      saveNote(id, { requestId: randomUUID(), revision: 0, blocks }),
    );
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/agents/${id}/note`);
    const editor = page.getByRole("textbox", {
      name: "Shared note",
      exact: true,
    });
    await editor.waitFor();
    const outline = page.getByRole("navigation", {
      name: "Table of contents",
      exact: true,
    });
    await outline
      .getByRole("button", { name: "Section 12", exact: true })
      .waitFor();
    const scroll = page.locator("[data-note-scroll]");
    const assertSingleScroll = async () => {
      assert.equal(
        await outline
          .locator(":scope > div")
          .evaluate((element) => getComputedStyle(element).overflowY),
        "hidden",
        "collapsed outline must not add a scrollbar",
      );
      assert.ok(
        await page.evaluate(
          () =>
            document.documentElement.scrollHeight <= innerHeight &&
            document.documentElement.scrollWidth <= innerWidth,
        ),
        "outer page must not scroll",
      );
      assert.equal(
        await page
          .locator("main")
          .evaluate(
            (main) =>
              [main, ...main.querySelectorAll<HTMLElement>("*")].filter(
                (element) =>
                  element.scrollHeight > element.clientHeight + 1 &&
                  /auto|scroll/.test(getComputedStyle(element).overflowY) &&
                  !element.closest('[aria-label="Table of contents"]'),
              ).length,
          ),
        1,
        "one main note scroll surface",
      );
    };
    await assertSingleScroll();
    const bounds = (await scroll.boundingBox())!;
    await page.mouse.move(bounds.x + 70, bounds.y + 160);
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(
      () => document.querySelector("[data-note-scroll]")!.scrollTop >= 490,
    );
    assert.equal(await page.evaluate(() => scrollY), 0);
    const before = await scroll.evaluate((element) => element.scrollTop);
    await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + 200);
    await page.mouse.wheel(0, 400);
    await page.waitForFunction(
      (top) =>
        document.querySelector("[data-note-scroll]")!.scrollTop > top + 300,
      before,
    );
    await outline
      .getByRole("button", { name: "Section 6", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-current="location"]')
          ?.getAttribute("aria-label") === "Section 6",
    );
    const offset = await editor
      .getByRole("heading", { name: "Section 6", exact: true })
      .evaluate(
        (element) =>
          element.getBoundingClientRect().top -
          document.querySelector("[data-note-scroll]")!.getBoundingClientRect()
            .top,
      );
    assert.ok(
      Math.abs(offset - 24) < 2,
      `section navigation offset: ${offset}`,
    );
    await page.keyboard.press("Escape");
    await assertSingleScroll();
    if (!hasTouch) {
      await outline
        .getByRole("button", { name: "Section 3", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () =>
          document
            .querySelector('[aria-current="location"]')
            ?.getAttribute("aria-label") === "Section 3",
      );
      await page.keyboard.press("Escape");
      const heading = editor.getByRole("heading", {
        name: "Section 3",
        exact: true,
      });
      await heading.click();
      await heading.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
      await page.keyboard.type("Updated section");
      await outline
        .getByRole("button", { name: "Updated section", exact: true })
        .waitFor();
      // Clear the fixture note: outline must disappear without stale targets.
      await editor.fill("A note without headings");
      // Replacing text preserves the first block type in a rich-text editor.
      await editor.press("ControlOrMeta+Alt+0");
      await outline.waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${width}x${height}: wheel over text/edge, one scroll surface, outline navigation and layout passed`,
    );
  }
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
  if (previous === undefined) delete process.env.ROOST_DATA_DIR;
  else process.env.ROOST_DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
}
