import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { type Browser, chromium, type Locator, type Page } from "playwright";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { setMessageReaction } from "../../src/server/runs/reactions.server";
import { openReplyThread } from "../../src/server/runs/threads.server";
import {
  putMessage,
  readTimeline,
} from "../../src/server/runs/timeline.server";

const screenshotDirectory = resolve(
  process.env.ROOST_TEST_SCREENSHOT_DIR ??
    join(tmpdir(), "roost-reactions-browser"),
);

async function waitUntil(check: () => Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail(label);
}

async function storedReaction(
  agentId: string,
  conversationId: string,
  messageId: string,
  emoji: string,
  active: boolean,
) {
  await waitUntil(
    async () => {
      const messages = await Effect.runPromise(
        readTimeline(agentId, conversationId),
      );
      const message = messages.find((message) => message.id === messageId);
      return (
        !!message?.reactions?.some(
          (reaction) => reaction.actor === "user" && reaction.emoji === emoji,
        ) === active
      );
    },
    `Expected ${emoji} to be ${active ? "stored" : "removed"} on ${messageId}`,
  );
}

async function activate(button: Locator, touch: boolean) {
  await button.scrollIntoViewIfNeeded();
  if (touch) await button.tap();
  else await button.click();
}

async function assertNoOverflow(page: Page, label: string) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `${label}: page fits the viewport`,
  );
}

async function seedFixture() {
  const id = randomUUID();
  await Effect.runPromise(
    saveAgent({
      id,
      name: "Reaction fixture",
      instructions: "Local fixture only",
      character: "moss",
      model: "fake",
    }),
  );
  await Effect.runPromise(
    withAgentStore((db) => {
      db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
      putMessage(db, id, {
        id: "user-message",
        role: "user",
        text: "Please review this release.",
      });
      putMessage(db, id, {
        id: "assistant-message",
        role: "assistant",
        text: "The release is ready.",
      });
      putMessage(db, id, {
        id: "long-assistant",
        role: "assistant",
        text:
          "Checklist: https://example.test/" +
          "long-path-".repeat(10) +
          "\n\n```text\n" +
          "long-code-".repeat(30) +
          "\n```",
      });
      putMessage(db, id, {
        id: "notice-message",
        role: "notice",
        text: "Fixture notice",
      });
    }),
  );
  const thread = await Effect.runPromise(
    openReplyThread(id, "assistant-message"),
  );
  await Effect.runPromise(
    withAgentStore((db) => {
      putMessage(
        db,
        id,
        {
          id: "thread-user",
          role: "user",
          text: "Does the reply view work too?",
        },
        thread.id,
      );
      putMessage(
        db,
        id,
        {
          id: "thread-assistant",
          role: "assistant",
          text: "Yes, replies support reactions.",
        },
        thread.id,
      );
    }),
  );
  return { id, threadId: thread.id };
}

async function verifyReactions(browser: Browser, base: string) {
  for (const responseStyle of ["codex", "messages"]) {
    for (const [label, width, height, hasTouch] of [
      ["desktop", 1440, 1000, false],
      ["mobile-touch", 390, 844, true],
      ["narrow-touch", 320, 844, true],
    ] as const) {
      const { id, threadId } = await seedFixture();
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch,
      });
      await context.addCookies([
        { name: "roost.responseStyle", value: responseStyle, url: base },
      ]);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      try {
        await page.goto(`${base}/agents/${id}`);
        const main = page.getByRole("region", {
          name: "Conversation with Reaction fixture",
          exact: true,
          includeHidden: true,
        });
        const row = main.locator('[data-message-id="assistant-message"]');
        await row.waitFor();
        const trigger = row.getByRole("button", {
          name: "Add reaction",
          exact: true,
        });
        await trigger.waitFor();
        // User messages display agent reactions but never offer a user reaction picker.
        assert.equal(
          await main
            .locator('[data-message-id="user-message"]')
            .getByRole("button", { name: "Add reaction", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await main
            .locator('[data-message-id="notice-message"]')
            .getByRole("button", { name: "Add reaction", exact: true })
            .count(),
          0,
        );

        if (hasTouch) await activate(trigger, true);
        else {
          await trigger.focus();
          await page.keyboard.press("Enter");
        }
        const picker = page.getByRole("dialog", { name: "Choose a reaction" });
        await picker.waitFor();
        assert.equal(
          await row
            .locator("fieldset")
            .evaluate((el) => getComputedStyle(el).borderWidth),
          "0px",
          "reaction strip does not retain the browser's native fieldset border",
        );
        assert.match(
          await picker.evaluate((el) => getComputedStyle(el).fontFamily),
          /Inter/,
          "portal reaction picker uses the app font",
        );
        await assertNoOverflow(page, `${responseStyle} ${label} picker`);
        if (process.env.ROOST_TEST_SCREENSHOTS) {
          mkdirSync(screenshotDirectory, { recursive: true });
          await page.waitForTimeout(350);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDirectory,
              `reactions-picker-${responseStyle}-${label}.png`,
            ),
          });
        }
        const pickerBounds = (await picker.boundingBox())!;
        assert.ok(
          pickerBounds.x >= 0 && pickerBounds.x + pickerBounds.width <= width,
        );
        const thumbsUp = picker.getByRole("button", {
          name: "React with thumbs up",
          exact: true,
        });
        if (hasTouch) {
          const bounds = (await trigger.boundingBox())!;
          assert.ok(
            bounds.width >= 44 && bounds.height >= 44,
            "touch reaction target is at least 44px",
          );
          const choiceBounds = (await thumbsUp.boundingBox())!;
          assert.ok(
            choiceBounds.width >= 44 && choiceBounds.height >= 44,
            "touch emoji choices are at least 44px",
          );
          await thumbsUp.tap();
        } else {
          assert.ok(
            await thumbsUp.evaluate((el) => el === document.activeElement),
            "keyboard picker focuses its first reaction",
          );
          await page.keyboard.press("Enter");
          await waitUntil(
            () => trigger.evaluate((el) => el === document.activeElement),
            "picker returns keyboard focus to its trigger",
          );
        }
        await storedReaction(id, id, "assistant-message", "👍", true);
        const chip = row.getByRole("button", {
          name: "Remove thumbs up reaction",
          exact: true,
        });
        await chip.waitFor();
        assert.equal(await chip.getAttribute("aria-pressed"), "true");
        await page.reload();
        await chip.waitFor();
        await activate(chip, hasTouch);
        await storedReaction(id, id, "assistant-message", "👍", false);
        await chip.waitFor({ state: "detached" });

        // A database mutation from the agent is picked up by the active UI poll.
        await Effect.runPromise(
          setMessageReaction(
            {
              agentId: id,
              conversationId: id,
              messageId: "user-message",
              emoji: "👀",
              active: true,
            },
            "assistant",
          ),
        );
        const user = main.locator('[data-message-id="user-message"]');
        await user
          .getByLabel("Reaction fixture reacted eyes", { exact: true })
          .waitFor();

        await Effect.runPromise(
          setMessageReaction(
            {
              agentId: id,
              messageId: "assistant-message",
              emoji: "👍",
              active: true,
            },
            "assistant",
          ),
        );
        const sharedChip = row.getByRole("button", {
          name: "Add thumbs up reaction",
          exact: true,
        });
        await sharedChip.waitFor();
        assert.equal(await sharedChip.getAttribute("aria-pressed"), "false");
        await activate(sharedChip, hasTouch);
        await storedReaction(id, id, "assistant-message", "👍", true);
        await chip.waitFor();
        assert.match(await chip.innerText(), /2/);
        await activate(chip, hasTouch);
        await storedReaction(id, id, "assistant-message", "👍", false);
        await sharedChip.waitFor();
        assert.equal(
          await sharedChip.getAttribute("title"),
          "Reaction fixture reacted 👍",
        );

        if (!hasTouch) {
          // Keep the optimistic reaction in flight, then reject it and retry.
          let releaseRequest: (() => void) | undefined;
          let requestStarted: (() => void) | undefined;
          const intercepted = new Promise<void>((done) => {
            requestStarted = done;
          });
          const released = new Promise<void>((done) => {
            releaseRequest = done;
          });
          await page.route("**/_serverFn/**", async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            requestStarted!();
            await Promise.race([
              released,
              new Promise((done) => setTimeout(done, 5000)),
            ]);
            await route.abort("failed");
          });
          await trigger.click();
          await picker
            .getByRole("button", {
              name: "React with celebration",
              exact: true,
            })
            .click();
          await Promise.race([
            intercepted,
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Reaction POST was not intercepted")),
                5000,
              ),
            ),
          ]);
          const group = row.getByRole("group", {
            name: "Message reactions",
            exact: true,
          });
          const pendingChip = row.getByRole("button", {
            name: "Remove celebration reaction",
            exact: true,
          });
          await pendingChip.waitFor();
          assert.equal(await group.getAttribute("aria-busy"), "true");
          assert.equal(await pendingChip.isDisabled(), true);
          assert.equal(await trigger.isDisabled(), true);
          releaseRequest!();
          await row
            .getByRole("alert")
            .filter({ hasText: "Could not update reaction. Try again." })
            .waitFor();
          await pendingChip.waitFor({ state: "detached" });
          await storedReaction(id, id, "assistant-message", "🎉", false);
          await page.unrouteAll({ behavior: "ignoreErrors" });
          await trigger.click();
          await picker
            .getByRole("button", {
              name: "React with celebration",
              exact: true,
            })
            .click();
          await storedReaction(id, id, "assistant-message", "🎉", true);
          await pendingChip.waitFor();
          await row.getByRole("alert").waitFor({ state: "detached" });

          await trigger.click();
          const custom = picker.getByRole("textbox", {
            name: "Any emoji",
            exact: true,
          });
          await custom.fill("not emoji");
          await custom.press("Enter");
          await picker
            .getByRole("alert")
            .filter({ hasText: "Enter a single emoji." })
            .waitFor();
          await custom.fill("👩🏽‍💻");
          await custom.press("Enter");
          await storedReaction(id, id, "assistant-message", "👩🏽‍💻", true);
          await row
            .getByRole("button", {
              name: "Remove 👩🏽‍💻 reaction",
              exact: true,
            })
            .waitFor();
        }

        await row.locator("article").hover();
        await activate(
          row.getByRole("button", { name: "Reply in thread", exact: true }),
          hasTouch,
        );
        const panel = page.getByRole("region", {
          name: "Reply thread",
          exact: true,
        });
        const reply = panel.locator('[data-message-id="thread-assistant"]');
        await reply.waitFor();
        await Effect.runPromise(
          setMessageReaction(
            {
              agentId: id,
              conversationId: threadId,
              messageId: "thread-user",
              emoji: "👀",
              active: true,
            },
            "assistant",
          ),
        );
        await panel
          .locator('[data-message-id="thread-user"]')
          .getByLabel("Reaction fixture reacted eyes", { exact: true })
          .waitFor();
        await activate(
          reply.getByRole("button", { name: "Add reaction", exact: true }),
          hasTouch,
        );
        await picker.waitFor();
        await activate(
          picker.getByRole("button", { name: "React with heart", exact: true }),
          hasTouch,
        );
        await storedReaction(id, threadId, "thread-assistant", "❤️", true);
        const replyChip = reply.getByRole("button", {
          name: "Remove heart reaction",
          exact: true,
        });
        await replyChip.waitFor();
        const parent = panel
          .getByRole("article")
          .filter({ hasText: "The release is ready." });
        await activate(
          parent.getByRole("button", { name: "Add reaction", exact: true }),
          hasTouch,
        );
        await activate(
          picker.getByRole("button", { name: "React with eyes", exact: true }),
          hasTouch,
        );
        await storedReaction(id, id, "assistant-message", "👀", true);
        await parent
          .getByRole("button", { name: "Remove eyes reaction", exact: true })
          .waitFor();
        await page.reload();
        await replyChip.waitFor();
        assert.equal(
          new URL(page.url()).searchParams.get("conversation"),
          threadId,
        );
        await assertNoOverflow(page, `${responseStyle} ${label} reply`);
        if (process.env.ROOST_TEST_SCREENSHOTS && width === 320) {
          await page.waitForTimeout(350);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDirectory,
              `reactions-thread-${responseStyle}-${label}.png`,
            ),
          });
        }
        await activate(
          panel.getByRole("button", { name: "Close thread", exact: true }),
          hasTouch,
        );
        await panel.waitFor({ state: "detached" });
        await row
          .getByRole("button", { name: "Remove eyes reaction", exact: true })
          .waitFor();
        await assertNoOverflow(page, `${responseStyle} ${label} conversation`);
        if (process.env.ROOST_TEST_SCREENSHOTS) {
          mkdirSync(screenshotDirectory, { recursive: true });
          await page.waitForTimeout(350);
          await page.screenshot({
            animations: "disabled",
            path: join(
              screenshotDirectory,
              `reactions-${responseStyle}-${label}.png`,
            ),
          });
        }
        console.log(
          `${responseStyle} ${label}: add/remove, reload, assistant sync, thread and overflow passed`,
        );
      } finally {
        await context.close();
      }
    }
  }
}

// Always uses its own loopback server and disposable database, never a live URL.
const directory = mkdtempSync(join(tmpdir(), "roost-browser-reactions-"));
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
  await waitUntil(async () => {
    try {
      return (
        await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })
      ).ok;
    } catch {
      return false;
    }
  }, `Production fixture server did not start: ${logs}`);
  await verifyReactions(browser, base);
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
