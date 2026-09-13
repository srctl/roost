import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { type Browser, chromium } from "playwright";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { openReplyThread } from "../../src/server/runs/threads.server";
import { putMessage } from "../../src/server/runs/timeline.server";

async function verifyReplyActions(browser: Browser, base: string) {
  for (const responseStyle of ["codex", "messages"]) {
    for (const [label, width, height, hasTouch] of [
      ["desktop", 1440, 1000, false],
      ["mobile-touch", 390, 844, true],
      ["desktop-touch", 1440, 1000, true],
    ] as const) {
      const id = randomUUID();
      await Effect.runPromise(
        saveAgent({
          id,
          name: "Reply actions",
          instructions: "Local fixture only",
          character: "moss",
          model: "fake",
        }),
      );
      await Effect.runPromise(
        withAgentStore((db) => {
          db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
          for (const message of [
            {
              id: "old-user",
              role: "user" as const,
              text: "Historical user thread",
            },
            {
              id: "empty-user",
              role: "user" as const,
              text: "Historical empty thread",
            },
            {
              id: "old-assistant",
              role: "assistant" as const,
              text: "Historical assistant thread",
            },
            {
              id: "new-user",
              role: "user" as const,
              text: "A new user message",
            },
            {
              id: "new-assistant",
              role: "assistant" as const,
              text:
                "A full width response with a long link: https://example.test/" +
                "long-path-".repeat(12) +
                "\n\n```text\n" +
                "wide-code-".repeat(40) +
                "\n```\n\n" +
                "| Check | Result |\n| --- | --- |\n| " +
                "wide-cell-".repeat(30) +
                " | Ready |",
              files: [
                {
                  id: "fixture-file",
                  name: "release-checklist-with-a-long-name.txt",
                  mimeType: "text/plain",
                  size: 48,
                  kind: "attachment" as const,
                  url: "/api/files/fixture-file",
                },
              ],
            },
          ])
            putMessage(db, id, message);
          putMessage(db, id, {
            id: "short-assistant",
            role: "assistant",
            text: "Ready.",
          });
          if (hasTouch)
            putMessage(db, id, {
              id: "touch-assistant",
              role: "assistant",
              text: "Another response for touch creation",
            });
        }),
      );
      const threads = new Map<string, string>();
      for (const root of ["old-user", "empty-user", "old-assistant"]) {
        const child = await Effect.runPromise(openReplyThread(id, root));
        threads.set(root, child.id);
        if (root !== "empty-user")
          await Effect.runPromise(
            withAgentStore((db) =>
              putMessage(
                db,
                id,
                {
                  id: `${root}-reply`,
                  role: "assistant",
                  text: "Historical reply",
                },
                child.id,
              ),
            ),
          );
      }
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch,
      });
      await context.addCookies([
        { name: "roost.responseStyle", value: responseStyle, url: base },
      ]);
      const page = await context.newPage();
      await page.goto(`${base}/agents/${id}`);
      const main = page.getByRole("region", {
        name: "Conversation with Reply actions",
        exact: true,
        includeHidden: true,
      });
      const shortRow = main.locator('[data-message-id="short-assistant"]');
      await shortRow.waitFor();
      const shortBounds = (await shortRow.boundingBox())!;
      const shortArticle = (await shortRow.locator("article").boundingBox())!;
      const shortAction = (await shortRow
        .getByRole("button", { name: "Reply in thread", exact: true })
        .boundingBox())!;
      assert.ok(
        shortArticle.x + shortArticle.width <
          shortBounds.x + shortBounds.width - 40,
        "short response shrinks to its content in either display mode",
      );
      assert.equal(
        shortArticle.x + shortArticle.width - shortAction.x - shortAction.width,
        4,
      );
      assert.equal(
        shortArticle.y +
          shortArticle.height -
          shortAction.y -
          shortAction.height,
        4,
      );
      assert.ok(
        shortAction.x >= shortArticle.x && shortAction.y >= shortArticle.y,
      );
      assert.ok(shortAction.width >= 40 && shortAction.height >= 40);
      const row = main.locator('[data-message-id="new-assistant"]');
      const action = row.getByRole("button", {
        name: "Reply in thread",
        exact: true,
      });
      await action.waitFor();
      assert.equal(
        await main
          .locator('[data-message-id="new-user"]')
          .getByRole("button")
          .count(),
        0,
      );
      assert.equal(await action.innerText(), "");
      assert.equal(await action.locator("svg[aria-hidden=true]").count(), 1);
      assert.equal(await action.getAttribute("title"), "Reply in thread");
      await action.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      const opacity = () =>
        action.evaluate((el) => getComputedStyle(el).opacity);
      assert.equal(
        await page.evaluate(() => matchMedia("(hover: hover)").matches),
        !hasTouch,
      );
      assert.equal(await opacity(), hasTouch ? "1" : "0");
      const geometry = () =>
        row.evaluate((el) => ({
          row: el.getBoundingClientRect().toJSON(),
          content: el
            .querySelector("article")!
            .getBoundingClientRect()
            .toJSON(),
        }));
      const rest = await geometry();
      assert.ok(
        rest.content.width <=
          rest.row.width * (responseStyle === "messages" ? 0.88 : 1) + 0.02,
      );
      assert.ok(
        await row
          .locator("article")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      );
      const target = (await action.boundingBox())!;
      const assertInsideArticle = async () => {
        const bounds = (await row.locator("article").boundingBox())!;
        const button = (await action.boundingBox())!;
        assert.ok(button.width >= 40 && button.height >= 40);
        assert.ok(button.x >= bounds.x && button.y >= bounds.y);
        assert.equal(bounds.x + bounds.width - button.x - button.width, 4);
        assert.equal(bounds.y + bounds.height - button.y - button.height, 4);
      };
      await assertInsideArticle();
      assert.equal(
        rest.row.bottom,
        rest.content.bottom,
        "no trailing action row",
      );
      assert.ok(target.y < rest.content.bottom);
      const assertContentClearance = async () => {
        const overlaps = await row.locator("article").evaluate((article) => {
          const target = article
            .querySelector("button")!
            .getBoundingClientRect();
          // These boxes bound visible text, links and clipped code/table content.
          return [
            ...article.querySelectorAll(
              'p, a, pre, [aria-label="Table"], [aria-label="Files"]',
            ),
          ]
            .filter((el) =>
              [...el.getClientRects()].some(
                (rect) =>
                  rect.left < target.right &&
                  rect.right > target.left &&
                  rect.top < target.bottom &&
                  rect.bottom > target.top,
              ),
            )
            .map((el) => el.tagName);
        });
        assert.deepEqual(
          overlaps,
          [],
          "text, links, code, table and files clear the target",
        );
      };
      await assertContentClearance();
      assert.equal(await row.locator("pre").count(), 1);
      assert.equal(await row.getByRole("region", { name: "Table" }).count(), 1);
      assert.equal(
        await row.getByRole("link", { name: /release-checklist/ }).count(),
        1,
      );
      await row.locator('pre, [aria-label="Table"]').evaluateAll((elements) => {
        for (const el of elements) el.scrollLeft = el.scrollWidth;
      });
      await assertContentClearance();
      if (!hasTouch) {
        await row.hover();
        await page.waitForTimeout(200);
        assert.equal(await opacity(), "1");
        assert.deepEqual(
          await geometry(),
          rest,
          "hover does not move or narrow content",
        );
      }
      await page.mouse.move(0, 0);
      // Reach the action by Tab from the preceding link, including when invisible.
      await row.getByRole("link").last().focus();
      await page.keyboard.press("Tab");
      assert.ok(await action.evaluate((el) => el === document.activeElement));
      await page.waitForTimeout(200);
      assert.equal(await opacity(), "1");
      assert.deepEqual(
        await geometry(),
        rest,
        "focus does not move or narrow content",
      );
      assert.equal(
        await action.evaluate((el) => getComputedStyle(el).outlineStyle),
        "solid",
      );
      const originalAction = await action.elementHandle();
      await page.keyboard.press("Enter");
      const panel = page.getByRole("region", {
        name: "Reply thread",
        exact: true,
      });
      await panel.getByRole("textbox").waitFor();
      const created = new URL(page.url()).searchParams.get("conversation");
      assert.ok(created && ![...threads.values()].includes(created));
      await row
        .getByRole("button", { name: /0 replies/, includeHidden: true })
        .waitFor({ state: "attached" });
      assert.ok(await originalAction!.evaluate((el) => el.isConnected));
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      assert.ok(
        await originalAction!.evaluate(
          (el) => el.isConnected && el === document.activeElement,
        ),
      );
      await assertInsideArticle();
      await assertContentClearance();
      const refreshed = await geometry();
      assert.equal(refreshed.content.width, rest.content.width);
      assert.equal(refreshed.content.height, rest.content.height);
      await page.keyboard.press("Enter");
      await panel.getByRole("textbox").waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("conversation"),
        created,
      );
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "detached" });
      // Counts remain visible and open every historical root, even empty user threads.
      for (const [root, child] of threads) {
        const nav = main
          .locator(`[data-message-id="${root}"]`)
          .getByRole("button", { name: /^Reply in thread: / });
        await nav.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        assert.equal(
          await nav.evaluate((el) => getComputedStyle(el).opacity),
          "1",
        );
        assert.match(
          await nav.innerText(),
          root === "empty-user" ? /0 replies/ : /1 reply · Unread/,
        );
        await nav.click();
        await panel.getByRole("textbox").waitFor();
        assert.equal(
          new URL(page.url()).searchParams.get("conversation"),
          child,
        );
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "detached" });
        assert.ok(await nav.evaluate((el) => el === document.activeElement));
      }
      if (hasTouch) {
        const touchRow = main.locator('[data-message-id="touch-assistant"]');
        const touchAction = touchRow.getByRole("button", {
          name: "Reply in thread",
          exact: true,
        });
        await touchAction.scrollIntoViewIfNeeded();
        assert.equal(
          await touchAction.evaluate((el) => getComputedStyle(el).opacity),
          "1",
        );
        const originalTouchAction = await touchAction.elementHandle();
        const touchBounds = (await touchRow.locator("article").boundingBox())!;
        const touchTarget = (await touchAction.boundingBox())!;
        assert.equal(
          touchBounds.x + touchBounds.width - touchTarget.x - touchTarget.width,
          4,
        );
        assert.equal(
          touchBounds.y +
            touchBounds.height -
            touchTarget.y -
            touchTarget.height,
          4,
        );
        assert.ok(touchTarget.width >= 40 && touchTarget.height >= 40);
        await touchAction.tap();
        await panel.getByRole("textbox").waitFor();
        await touchRow
          .getByRole("button", { name: /0 replies/, includeHidden: true })
          .waitFor({ state: "attached" });
        assert.ok(await originalTouchAction!.evaluate((el) => el.isConnected));
        const touchCreated = new URL(page.url()).searchParams.get(
          "conversation",
        );
        assert.ok(
          touchCreated &&
            touchCreated !== created &&
            ![...threads.values()].includes(touchCreated),
        );
        await panel
          .getByRole("button", { name: "Close thread", exact: true })
          .tap();
        await panel.waitFor({ state: "detached" });
        assert.ok(
          await originalTouchAction!.evaluate(
            (el) => el.isConnected && el === document.activeElement,
          ),
        );
        await touchAction.tap();
        await panel.getByRole("textbox").waitFor();
        assert.equal(
          new URL(page.url()).searchParams.get("conversation"),
          touchCreated,
        );
        await page.keyboard.press("Escape");
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await context.close();
      console.log(
        `${responseStyle} ${label}: reply roles, visibility, keyboard creation, historical navigation and geometry passed`,
      );
    }
  }
}

// Always launches its own loopback server and database. Never accepts a live URL.
const directory = mkdtempSync(join(tmpdir(), "roost-browser-threads-"));
const previous = process.env.ROOST_DATA_DIR;
process.env.ROOST_DATA_DIR = directory;
writeFileSync(
  join(directory, "auth.json"),
  JSON.stringify({ OPENAI_API_KEY: "fixture" }),
);
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>((done) => probe.close(() => done()));
const env = {
  ...process.env,
  ROOST_DATA_DIR: directory,
  CODEX_HOME: directory,
  ROOST_CODEX_BINARY: resolve("tests/fixtures/chat-server.mjs"),
  HOST: "127.0.0.1",
  PORT: String(port),
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: String(port),
};
for (const key of [
  "ROOST_DESKTOP_ORIGIN",
  "ROOST_DESKTOP_DISPLAY",
  "ROOST_DESKTOP_VNC_PORT",
  "ROOST_PUSH_SUBJECT",
])
  delete env[key as keyof typeof env];
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (data) => {
  logs += data;
});
server.stderr.on("data", (data) => {
  logs += data;
});
let browser: Browser | undefined;
const base = `http://127.0.0.1:${port}`;
try {
  browser = await chromium.launch({
    executablePath: process.env.ROOST_TEST_CHROME || undefined,
    args: ["--no-sandbox"],
  });

  for (let i = 0; i < 100; i++) {
    try {
      if (
        (
          await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok
      )
        break;
    } catch {}
    if (i === 99) throw new Error(logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  await verifyReplyActions(browser, base);
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    console.log(`${label}: starting isolated browser fixture`);
    const id = randomUUID();
    await Effect.runPromise(
      saveAgent({
        id,
        name: "Thread fixture",
        instructions: "Local fixture only",
        character: "moss",
        model: "fake",
      }),
    );
    await Effect.runPromise(
      withAgentStore((db) => {
        db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
        for (let i = 0; i < 180; i++)
          putMessage(db, id, {
            id: `main-${i}`,
            role: "user",
            text: `Release decision ${i}: verify keyboard access.`,
          });
      }),
    );
    const child = await Effect.runPromise(openReplyThread(id, "main-179"));
    const sibling = await Effect.runPromise(openReplyThread(id, "main-178"));
    await Effect.runPromise(
      withAgentStore((db) => {
        for (let i = 0; i < 90; i++)
          putMessage(
            db,
            id,
            { id: `child-${i}`, role: "assistant", text: `Scoped reply ${i}` },
            child.id,
          );
        putMessage(
          db,
          id,
          {
            id: "sibling-decision",
            role: "assistant",
            text: "Sibling decision: keyboard checks passed",
          },
          sibling.id,
        );
      }),
    );
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(`${base}/agents/${id}`);
    const main = page.getByRole("region", {
      name: "Conversation with Thread fixture",
      exact: true,
      includeHidden: true,
    });
    await main.getByRole("textbox").fill("Main draft");
    const mainHistory = main.locator('[aria-label="Conversation history"]');
    await mainHistory.evaluate((el) => {
      el.scrollTop = 500;
    });
    await page.waitForTimeout(300);
    const count = await main.locator("[data-message-id]").count();
    const top = await mainHistory.evaluate((el) => el.scrollTop);
    await page.evaluate((child) => {
      history.pushState(null, "", `?conversation=${child}#child-0`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, child.id);
    const panel = page.getByRole("region", {
      name: "Reply thread",
      exact: true,
    });
    await panel.locator('[id="child-0"]').waitFor();
    await page.waitForTimeout(1200);
    const reply = panel.locator('[id="child-0"]');
    await reply.getByText("Thread fixture", { exact: true }).waitFor();
    assert.ok(await reply.locator("time").getAttribute("datetime"));
    assert.equal(await reply.locator("img").count(), 1);
    assert.equal(
      await reply
        .locator("article")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    assert.equal(await main.locator("[data-message-id]").count(), count);
    assert.equal(await mainHistory.evaluate((el) => el.scrollTop), top);
    const childHistory = panel.locator('[aria-label="Conversation history"]');
    await childHistory.evaluate((el) => {
      el.scrollTop = 450;
    });
    await page.waitForTimeout(2100);
    assert.equal(await childHistory.evaluate((el) => el.scrollTop), 450);
    const visibleMessage = () =>
      childHistory.evaluate((el) => {
        const top = el.getBoundingClientRect().top;
        return [...el.querySelectorAll<HTMLElement>("[data-message-id]")].find(
          (node) => node.getBoundingClientRect().bottom > top,
        )?.dataset.messageId;
      });
    const anchor = await visibleMessage();
    await panel
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await Effect.runPromise(
      withAgentStore((db) => {
        for (let i = 90; i < 110; i++)
          putMessage(
            db,
            id,
            { id: `child-${i}`, role: "assistant", text: `New reply ${i}` },
            child.id,
          );
      }),
    );
    await page.evaluate((child) => {
      history.pushState(null, "", `?conversation=${child}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, child.id);
    await panel.locator(`[data-message-id="${anchor}"]`).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(
      await visibleMessage(),
      anchor,
      "reopen restores message identity after newer replies",
    );
    await page.reload();
    await panel.locator(`[data-message-id="${anchor}"]`).waitFor();
    await page.waitForTimeout(1200);
    assert.equal(
      await visibleMessage(),
      anchor,
      "reload restores older-page message identity",
    );
    console.log(`${label}: older-page anchors survive reopen/reload`);
    await panel
      .getByRole("button", { name: "Scroll to bottom", exact: true })
      .click();
    assert.ok(
      await childHistory.evaluate(
        (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 2,
      ),
      "upstream bottom control works in a restored thread",
    );
    await panel.getByRole("textbox").fill("Child draft");
    await panel.locator('input[type="file"]').setInputFiles({
      name: "checklist.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Keyboard acceptance"),
    });
    await panel.getByRole("button", { name: "Remove checklist.txt" }).waitFor();
    await page.reload();
    await panel.getByRole("button", { name: "Remove checklist.txt" }).waitFor();
    assert.equal(await panel.getByRole("textbox").inputValue(), "Child draft");
    if (label === "mobile") {
      await panel
        .getByRole("button", { name: "Close thread", exact: true })
        .focus();
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("Tab");
        assert.ok(
          await panel.evaluate((el) => el.contains(document.activeElement)),
        );
      }
    }
    await panel
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    assert.equal(await main.getByRole("textbox").inputValue(), "Main draft");
    const opener = main.getByRole("button", {
      name: /Reply in thread: Release decision 179:/,
    });
    await opener.click();
    await panel.getByRole("textbox").waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "detached" });
    assert.ok(await opener.evaluate((el) => el === document.activeElement));
    await opener.click();
    await panel.getByRole("button", { name: "Remove checklist.txt" }).waitFor();
    await panel.getByRole("textbox").fill("stream");
    await panel
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await panel.getByText("Hello", { exact: true }).waitFor();
    await panel
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await page.waitForTimeout(4000);
    assert.match((await opener.getAttribute("aria-label"))!, /Unread/);
    await opener.click();
    await panel.getByRole("textbox").waitFor();
    await page.waitForURL(`**?conversation=${child.id}`);
    await page.reload();
    await panel.getByRole("link", { name: "checklist.txt" }).first().waitFor();
    console.log(
      `${label}: draft, focus, stream, unread and attachment reload passed`,
    );
    await Effect.runPromise(
      withAgentStore((db) =>
        putMessage(db, id, {
          id: "latest-decision",
          role: "user",
          text: "New main decision: launch Friday",
        }),
      ),
    );
    await panel.getByRole("textbox").fill("shared-context");
    await panel
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await panel.getByText(/Retrieved shared conversation context:/).waitFor();
    assert.match(await panel.innerText(), /launch Friday/);
    assert.match(await panel.innerText(), /keyboard checks passed/);
    // Delay the next snapshot and inspect every DOM mutation during a direct sibling switch.
    await page.route("**/_serverFn/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue().catch(() => {
        /* A cancelled poll can finish while the route is removed. */
      });
    });
    await page.evaluate((sibling) => {
      const region = document.querySelector('[aria-label="Reply thread"]')!;
      (window as typeof window & { threadLeaks?: string[] }).threadLeaks = [];
      const observer = new MutationObserver(() => {
        if (
          new URLSearchParams(location.search).get("conversation") ===
            sibling &&
          region.textContent?.includes("Retrieved shared conversation context")
        )
          (
            window as typeof window & { threadLeaks: string[] }
          ).threadLeaks.push("old content");
      });
      observer.observe(region, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      history.pushState(null, "", `?conversation=${sibling}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, sibling.id);
    await panel
      .getByText("Sibling decision: keyboard checks passed", { exact: true })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(
        () => (window as typeof window & { threadLeaks: string[] }).threadLeaks,
      ),
      [],
    );
    console.log(`${label}: sibling snapshot isolation passed`);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.evaluate((child) => {
      history.pushState(null, "", `?conversation=${child}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, child.id);
    await panel.getByRole("textbox").waitFor();
    await panel.getByRole("textbox").fill("slow");
    await panel
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Stop response", exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await main
      .getByRole("button", {
        name: /Reply in thread: Release decision 179:.*running/,
      })
      .waitFor();
    await main.getByRole("textbox").fill("Queued main request");
    await main
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await main
      .getByText("Queued — waiting for the agent’s active conversation.", {
        exact: true,
      })
      .waitFor();
    await opener.click();
    await panel
      .getByRole("button", { name: "Stop response", exact: true })
      .click();
    await panel.getByText("Run stopped", { exact: true }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await context.close();
    console.log(
      `${label}: drafts, attachments, focus, anchors/scroll, unread, runtime retrieval, queue/cancel passed`,
    );
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
  if (previous === undefined) delete process.env.ROOST_DATA_DIR;
  else process.env.ROOST_DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
}
