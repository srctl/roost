import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { chromium } from "playwright";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { setDashboardPreference } from "../../src/server/dashboards/store.server";
import { MobileTokens } from "../../src/server/mobile/tokens.server";

const directory = mkdtempSync(join(tmpdir(), "roost-trackers-browser-"));
process.env.ROOST_DATA_DIR = directory;
writeFileSync(
  join(directory, "auth.json"),
  JSON.stringify({ OPENAI_API_KEY: "fixture" }),
);
const id = randomUUID();
await Effect.runPromise(
  saveAgent({
    id,
    name: "Moss",
    character: "moss",
    model: "fixture",
    instructions: "Local test fixture",
  }),
);
await Effect.runPromise(
  withAgentStore((db) => {
    db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
  }),
);
await Effect.runPromise(setDashboardPreference(true));
const tokens = new MobileTokens(directory);
const device = tokens.create("Tracker browser verification");
tokens.close();
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const address = probe.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
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
delete env.TYPESAFE_API_KEY;
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
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  executablePath: process.env.ROOST_TEST_CHROME,
  args: ["--no-sandbox"],
});
const output = resolve("output/playwright/juxi");
mkdirSync(output, { recursive: true });
async function mobile(path: string, value?: unknown) {
  return fetch(`${base}/api/mobile/v1/agents/${id}/${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${device.secret}`,
      "Content-Type": "application/json",
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}
try {
  for (let attempt = 0; attempt < 100; attempt++) {
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
    if (attempt === 99) throw new Error(logs);
    await new Promise((done) => setTimeout(done, 100));
  }
  for (const [label, width, height, colorScheme] of [
    ["desktop", 1440, 1000, "light"],
    ["phone", 390, 844, "dark"],
    ["narrow", 320, 700, "light"],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/agents/${id}/dashboard`);
    if (width > 1100)
      await page
        .getByRole("button", { name: "Hide chat", exact: true })
        .click();
    if (label === "desktop") {
      for (const [kind, title] of [
        ["todo", "This week"],
        ["calories", "Meal log"],
      ] as const) {
        await page
          .getByRole("button", { name: "Add tracker", exact: true })
          .click();
        const form = page.getByRole("form", { name: "New tracker" });
        await form
          .getByLabel("Tracker type", { exact: true })
          .selectOption(kind);
        await form.getByLabel("Tracker name", { exact: true }).fill(title);
        await form.getByRole("button", { name: "Create tracker" }).click();
        await page.getByRole("article", { name: title, exact: true }).waitFor();
      }
      const todo = page.getByRole("article", {
        name: "This week",
        exact: true,
      });
      for (const task of [
        "Review the Roost preview",
        "Pick up groceries",
        "Book a dentist appointment",
      ]) {
        await todo.getByLabel("New task", { exact: true }).fill(task);
        await todo
          .getByRole("button", { name: "Add task", exact: true })
          .click();
        await todo.getByRole("checkbox", { name: task, exact: true }).waitFor();
      }
      await todo
        .getByRole("checkbox", { name: "Pick up groceries", exact: true })
        .click();
      await todo.getByRole("button", { name: "Show completed (1)" }).click();
      const meal = page.getByRole("article", { name: "Meal log", exact: true });
      for (const [name, calories] of [
        ["Oatmeal, berries and yogurt", "420"],
        ["Chicken and rice bowl", "610"],
        ["Apple and peanut butter", "180"],
      ]) {
        await meal.getByLabel("Meal or snack", { exact: true }).fill(name!);
        await meal.getByLabel("Calories", { exact: true }).fill(calories!);
        await meal
          .getByRole("button", { name: "Log meal", exact: true })
          .click();
        await meal.getByText(name!, { exact: true }).waitFor();
      }
      await meal.getByText("1,210", { exact: true }).waitFor();
      await todo
        .getByLabel("New task", { exact: true })
        .fill("Keep this task draft");
      await page.getByLabel("View", { exact: true }).selectOption("tables");
      await page.getByLabel("View", { exact: true }).selectOption("tasks");
      assert.equal(
        await todo.getByLabel("New task", { exact: true }).inputValue(),
        "Keep this task draft",
      );
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Reset view", exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(
        await todo.getByLabel("New task", { exact: true }).inputValue(),
        "Keep this task draft",
      );
      await todo.getByLabel("New task", { exact: true }).fill("");
      // Drop the response after the server has committed. Retry must confirm the
      // same entry instead of appending a duplicate, even after the widget refreshes.
      let responseDropped = false;
      await page.route("**/*", async (route) => {
        if (
          !responseDropped &&
          route.request().method() === "POST" &&
          route.request().postData()?.includes("Lost response meal")
        ) {
          responseDropped = true;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await meal
        .getByLabel("Meal or snack", { exact: true })
        .fill("Lost response meal");
      await meal.getByLabel("Calories", { exact: true }).fill("100");
      await meal.getByRole("button", { name: "Log meal", exact: true }).click();
      await meal
        .getByRole("button", { name: "Retry save", exact: true })
        .waitFor();
      assert.equal(
        await meal.getByLabel("Meal or snack", { exact: true }).isDisabled(),
        true,
      );
      await page.getByLabel("View", { exact: true }).selectOption("tasks");
      await page.getByLabel("View", { exact: true }).selectOption("all");
      await meal
        .getByRole("button", { name: "Retry save", exact: true })
        .waitFor();
      await meal
        .getByRole("button", { name: "Retry save", exact: true })
        .click();
      await meal
        .getByRole("button", { name: "Retry save", exact: true })
        .waitFor({ state: "hidden" });
      await meal.getByText("1,310", { exact: true }).waitFor();
      assert.equal(
        await meal.getByText("Lost response meal", { exact: true }).count(),
        1,
      );
      assert.equal(responseDropped, true);
      await page.unroute("**/*");
      await meal
        .getByRole("button", {
          name: "Delete meal Lost response meal",
          exact: true,
        })
        .click();
      await meal.getByText("1,210", { exact: true }).waitFor();
      const today = await meal.getByLabel("Log date").inputValue();
      await meal.getByLabel("Log date").fill("2026-01-02");
      await meal
        .getByText("No meals logged for this day.", { exact: true })
        .waitFor();
      await meal.getByLabel("Log date").fill(today);
      await meal.getByText("1,210", { exact: true }).waitFor();
      // A concurrent native edit makes this browser's revision stale. It must reload
      // without applying the stale action or losing the typed task.
      const snapshot = await (await mobile("dashboard")).json();
      const savedTodo = snapshot.widgets.find(
        (widget: { title: string }) => widget.title === "This week",
      );
      const first = savedTodo.blocks[0].items[0];
      assert.equal(
        (
          await mobile("dashboard/action", {
            key: savedTodo.key,
            expectedRevision: savedTodo.revision,
            blockId: "items",
            action: "set-todo",
            id: first.id,
            done: true,
          })
        ).status,
        200,
      );
      await todo
        .getByLabel("New task", { exact: true })
        .fill("Remember the reusable bags");
      await todo.getByRole("button", { name: "Add task", exact: true }).click();
      await todo.getByRole("alert").waitFor();
      assert.equal(
        await todo.getByLabel("New task", { exact: true }).inputValue(),
        "Remember the reusable bags",
      );
      await todo.getByRole("button", { name: "Add task", exact: true }).click();
      await todo
        .getByRole("checkbox", {
          name: "Remember the reusable bags",
          exact: true,
        })
        .waitFor();
      await todo
        .getByRole("button", {
          name: "Delete task Remember the reusable bags",
          exact: true,
        })
        .click();
      await todo
        .getByRole("checkbox", {
          name: "Remember the reusable bags",
          exact: true,
        })
        .waitFor({ state: "hidden" });
      await page.reload();
      await page
        .getByRole("button", { name: "Hide chat", exact: true })
        .click();
    }
    const todo = page.getByRole("article", { name: "This week", exact: true });
    const meal = page.getByRole("article", { name: "Meal log", exact: true });
    await meal.getByText("1,210", { exact: true }).waitFor();
    await todo
      .getByRole("checkbox", {
        name: "Book a dentist appointment",
        exact: true,
      })
      .waitFor();
    await todo.getByRole("button", { name: "Show completed (2)" }).click();
    assert.equal(
      await todo
        .getByRole("checkbox", {
          name: "Review the Roost preview",
          exact: true,
        })
        .isChecked(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: join(output, `${label}-trackers.png`),
      fullPage: true,
    });
    if (width <= 1100) {
      await meal.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(output, `${label}-calories.png`),
        fullPage: true,
      });
    }
    console.log(
      `${label}: real tracker creation, data entry, day totals, completion, reload, conflict/draft recovery and geometry passed`,
    );
    await context.close();
  }
} catch (error) {
  console.error(logs.slice(-5000));
  throw error;
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  rmSync(directory, { recursive: true, force: true });
}
