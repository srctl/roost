import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { chromium, type Locator, type Page } from "playwright";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { handleAgentTool } from "../../src/server/codex/agent-tools.server";
import {
  deleteDashboard,
  listDashboards,
  setDashboardPreference,
} from "../../src/server/dashboards/store.server";
import { MobileTokens } from "../../src/server/mobile/tokens.server";
import {
  claimRun,
  enqueueChat,
  finishRun,
  schedulerTick,
} from "../../src/server/runs/store.server";
import { openReplyThread } from "../../src/server/runs/threads.server";
import { readTimeline } from "../../src/server/runs/timeline.server";

// Built app, real tools and persistence, disposable data, no live model or worker.
const directory = mkdtempSync(join(tmpdir(), "roost-chat-trackers-browser-"));
process.env.ROOST_DATA_DIR = directory;
writeFileSync(
  join(directory, "auth.json"),
  JSON.stringify({ OPENAI_API_KEY: "fixture" }),
);
const run = Effect.runPromise;
const owner = randomUUID();
const today = new Date();
const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
await run(setDashboardPreference(true));

async function seed(name: string) {
  const id = randomUUID();
  await run(
    saveAgent({
      id,
      name,
      character: "moss",
      model: "fixture",
      instructions: "Local browser fixture only",
    }),
  );
  await run(
    withAgentStore((db) => {
      db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
    }),
  );
  async function turn(text: string, conversationId = id) {
    const messageId = randomUUID();
    await run(enqueueChat({ agentId: id, conversationId, messageId, text }));
    await run(schedulerTick(owner));
    const active = await run(claimRun(owner, false));
    assert.equal(active?.id, messageId);
    assert.ok(active);
    return active;
  }
  const first = await turn(
    "Can you keep my weekend checklist and meal log here?",
  );
  const context = {
    agentId: id,
    runId: first.id,
    allowMutations: true as const,
  };
  for (const widget of [
    {
      key: "weekend",
      title: "Weekend checklist",
      blocks: [
        {
          type: "todo-list",
          id: "items",
          items: [
            { id: randomUUID(), label: "Pick up groceries", done: false },
            { id: randomUUID(), label: "Water the plants", done: false },
          ],
        },
      ],
    },
    {
      key: "meals",
      title: "Meals today",
      blocks: [
        {
          type: "calorie-log",
          id: "meals",
          entries: [
            {
              id: randomUUID(),
              date: day,
              label: "Oatmeal and berries",
              calories: 420,
            },
          ],
        },
      ],
    },
    {
      key: "private-to-dashboard",
      title: "Saved but not shown",
      blocks: [
        { type: "markdown", text: "This widget was not attached to chat." },
      ],
    },
  ]) {
    const result = await handleAgentTool(
      context,
      "roost_save_dashboard",
      widget,
    );
    assert.equal(result.success, true, JSON.stringify(result));
  }
  assert.equal((await run(readTimeline(id))).length, 1, "saving stays quiet");
  for (const key of ["weekend", "meals", "weekend"]) {
    const result = await handleAgentTool(context, "roost_show_dashboard", {
      key,
    });
    assert.equal(result.success, true, JSON.stringify(result));
  }
  assert.equal(
    (await run(readTimeline(id))).length,
    3,
    "repeat show in a turn is idempotent",
  );
  await run(finishRun(first, "completed", []));

  const second = await turn(
    "Show the same checklist again so I can update it.",
  );
  const result = await handleAgentTool(
    { ...context, runId: second.id },
    "roost_show_dashboard",
    { key: "weekend" },
  );
  assert.equal(result.success, true, JSON.stringify(result));
  await run(finishRun(second, "completed", []));

  const thread = await run(openReplyThread(id, first.id));
  const reply = await turn(
    "Keep the same trackers in this reply too.",
    thread.id,
  );
  for (const key of ["weekend", "meals"]) {
    const result = await handleAgentTool(
      { ...context, runId: reply.id },
      "roost_show_dashboard",
      { key },
    );
    assert.equal(result.success, true, JSON.stringify(result));
  }
  await run(finishRun(reply, "completed", []));
  return {
    id,
    name,
    thread: thread.id,
    parent: first.id,
    first: `dashboard:${first.id}:weekend`,
    second: `dashboard:${second.id}:weekend`,
    meal: `dashboard:${first.id}:meals`,
    reply: `dashboard:${reply.id}:weekend`,
    replyMeal: `dashboard:${reply.id}:meals`,
  };
}

const cases = [];
for (const responseStyle of ["codex", "messages"] as const) {
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["phone", 390, 844],
    ["narrow", 320, 700],
  ] as const) {
    cases.push({
      responseStyle,
      label,
      width,
      height,
      ...(await seed("Moss")),
    });
  }
}
await run(withAgentStore((db) => db.exec("DELETE FROM worker_lease")));
const tokens = new MobileTokens(directory);
const device = tokens.create("Inline tracker browser verification");
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
const browser = await chromium
  .launch({
    executablePath: process.env.ROOST_TEST_CHROME,
    args: ["--no-sandbox"],
  })
  .catch(async (error) => {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    rmSync(directory, { recursive: true, force: true });
    throw error;
  });
const output = resolve("output/playwright/juxi");
mkdirSync(output, { recursive: true });
let currentPage: Page | undefined;

function widget(region: Locator, messageId: string, title: string) {
  return region
    .locator(`[data-message-id="${messageId}"]`)
    .getByRole("article", { name: title, exact: true, includeHidden: true });
}
async function geometry(page: Page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const duplicateIds = await page
    .locator("input[id], textarea[id], select[id]")
    .evaluateAll((nodes) => {
      const ids = nodes.map((node) => node.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
  assert.deepEqual(
    duplicateIds,
    [],
    "repeated widget references have unique form IDs",
  );
  for (const article of await page
    .getByRole("article", { name: /^(Weekend checklist|Meals today)$/ })
    .all()) {
    assert.equal(
      await article.evaluate(
        (node) => node.scrollWidth <= node.clientWidth + 1,
      ),
      true,
      "inline tracker does not overflow its message",
    );
  }
}
async function unchangedRuns(id: string) {
  const counts = await run(
    withAgentStore((db) =>
      db
        .prepare(
          "SELECT COUNT(*) AS count, SUM(status <> 'completed') AS unfinished FROM runs WHERE agentId=?",
        )
        .get(id),
    ),
  );
  assert.equal(counts?.count, 3, "tracker controls must not submit chat");
  assert.equal(counts?.unfinished, 0);
}
async function mobile(id: string, path: string, value?: unknown) {
  const response = await fetch(`${base}/api/mobile/v1/agents/${id}/${path}`, {
    method: value === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${device.secret}`,
      "Content-Type": "application/json",
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  assert.equal(response.status, 200);
  return response.json();
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
  for (const fixture of cases) {
    const { id, name, responseStyle, label, width, height } = fixture;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 700,
      reducedMotion: "reduce",
      colorScheme: label === "phone" ? "dark" : "light",
    });
    await context.addCookies([
      { name: "roost.responseStyle", value: responseStyle, url: base },
    ]);
    const page = await context.newPage();
    currentPage = page;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/agents/${id}`);
    if (width > 1100) {
      await page
        .getByRole("button", { name: "Collapse sidebar", exact: true })
        .click();
    }
    const main = page.getByRole("region", {
      name: `Conversation with ${name}`,
      exact: true,
      includeHidden: true,
    });
    const composer = main.getByRole("textbox", {
      name: `Message ${name}`,
      exact: true,
      includeHidden: true,
    });
    const todo = widget(main, fixture.first, "Weekend checklist");
    const repeated = widget(main, fixture.second, "Weekend checklist");
    const meal = widget(main, fixture.meal, "Meals today");
    await todo.getByLabel("New task", { exact: true }).waitFor();
    assert.equal(
      await main
        .getByRole("article", { name: "Saved but not shown", exact: true })
        .count(),
      0,
    );
    await composer.fill("Keep my unsent chat draft");
    await todo.getByLabel("New task", { exact: true }).fill("Book the dentist");
    await todo.getByLabel("New task", { exact: true }).press("Enter");
    await repeated
      .getByRole("checkbox", { name: "Book the dentist", exact: true })
      .waitFor();
    assert.equal(await composer.inputValue(), "Keep my unsent chat draft");
    await repeated
      .getByRole("checkbox", { name: "Water the plants", exact: true })
      .click();
    await todo
      .getByRole("button", { name: "Show completed (1)", exact: true })
      .click();
    assert.equal(
      await todo
        .getByRole("checkbox", { name: "Water the plants", exact: true })
        .isChecked(),
      true,
    );
    if (responseStyle === "codex" && label === "desktop") {
      // Native edits race a stale inline browser revision. The rejected save
      // keeps its draft, reloads current content, and succeeds once on retry.
      const snapshot = await mobile(id, "dashboard/chat?key=weekend");
      const current = snapshot.widgets[0];
      await mobile(id, "dashboard/action", {
        key: current.key,
        expectedRevision: current.revision,
        blockId: "items",
        action: "add-todo",
        id: randomUUID(),
        label: "From another device",
      });
      await todo
        .getByLabel("New task", { exact: true })
        .fill("Keep this tracker draft");
      await todo.getByRole("button", { name: "Add task", exact: true }).click();
      await todo.getByRole("alert").waitFor();
      assert.equal(
        await todo.getByLabel("New task", { exact: true }).inputValue(),
        "Keep this tracker draft",
      );
      assert.equal(
        await todo
          .getByRole("checkbox", {
            name: "Keep this tracker draft",
            exact: true,
          })
          .count(),
        0,
      );
      await todo.getByRole("button", { name: "Add task", exact: true }).click();
      await repeated
        .getByRole("checkbox", { name: "Keep this tracker draft", exact: true })
        .waitFor();
      const confirmed = await mobile(id, "dashboard/chat?key=weekend");
      assert.equal(
        confirmed.widgets[0].blocks[0].items.filter(
          (item: { label: string }) => item.label === "Keep this tracker draft",
        ).length,
        1,
      );
      for (const label of ["From another device", "Keep this tracker draft"]) {
        await todo
          .getByRole("button", { name: `Delete task ${label}`, exact: true })
          .click();
        await repeated
          .getByRole("checkbox", { name: label, exact: true })
          .waitFor({ state: "hidden" });
      }
    }
    await meal
      .getByLabel("Meal or snack", { exact: true })
      .fill("Chicken and rice bowl");
    await meal.getByLabel("Calories", { exact: true }).fill("610");
    await meal.getByLabel("Calories", { exact: true }).press("Enter");
    await meal.getByText("1,030", { exact: true }).waitFor();
    await unchangedRuns(id);
    await geometry(page);
    await repeated.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(output, `${responseStyle}-${label}-chat-todo.png`),
    });
    await meal.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(output, `${responseStyle}-${label}-chat-calories.png`),
    });

    await page.goto(`${base}/agents/${id}?conversation=${fixture.thread}`);
    const reply = page.getByRole("region", {
      name: "Reply thread",
      exact: true,
    });
    const replyComposer = reply.getByRole("textbox", {
      name: `Message ${name}`,
      exact: true,
    });
    const replyTodo = widget(reply, fixture.reply, "Weekend checklist");
    const replyMeal = widget(reply, fixture.replyMeal, "Meals today");
    await replyTodo
      .getByRole("checkbox", { name: "Book the dentist", exact: true })
      .waitFor();
    await replyComposer.fill("Keep my reply draft too");
    await replyTodo
      .getByLabel("New task", { exact: true })
      .fill("Plan the next hike");
    await replyTodo
      .getByRole("button", { name: "Add task", exact: true })
      .click();
    await replyTodo
      .getByRole("checkbox", { name: "Plan the next hike", exact: true })
      .waitFor();
    await replyMeal.getByText("1,030", { exact: true }).waitFor();
    await replyMeal
      .getByLabel("Meal or snack", { exact: true })
      .fill("Apple and peanut butter");
    await replyMeal.getByLabel("Calories", { exact: true }).fill("180");
    await replyMeal
      .getByRole("button", { name: "Log meal", exact: true })
      .click();
    await replyMeal.getByText("1,210", { exact: true }).waitFor();
    assert.equal(await replyComposer.inputValue(), "Keep my reply draft too");
    assert.equal(await composer.inputValue(), "Keep my unsent chat draft");
    assert.equal(
      await repeated
        .getByRole("checkbox", {
          name: "Plan the next hike",
          exact: true,
          includeHidden: true,
        })
        .count(),
      1,
      "reply edits update the main reference immediately without polling",
    );
    const openReplies = main
      .locator(`[data-message-id="${fixture.parent}"]`)
      .getByRole("button", { name: /^Reply in thread:/ });
    await replyTodo
      .getByLabel("New task", { exact: true })
      .fill("Keep my unsaved tracker task");
    await reply
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    assert.equal(
      await repeated.getByLabel("New task", { exact: true }).inputValue(),
      "Keep my unsaved tracker task",
    );
    await openReplies.click();
    await replyTodo.getByLabel("New task", { exact: true }).waitFor();
    assert.equal(
      await replyTodo.getByLabel("New task", { exact: true }).inputValue(),
      "Keep my unsaved tracker task",
    );
    await replyTodo.getByLabel("New task", { exact: true }).fill("");
    if (responseStyle === "codex" && label === "desktop") {
      let responseDropped = false;
      await page.route("**/*", async (route) => {
        if (
          !responseDropped &&
          route.request().method() === "POST" &&
          route.request().postData()?.includes("Retry this inline tracker task")
        ) {
          responseDropped = true;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      });
      await replyTodo
        .getByLabel("New task", { exact: true })
        .fill("Retry this inline tracker task");
      await replyTodo
        .getByRole("button", { name: "Add task", exact: true })
        .click();
      await replyTodo
        .getByRole("button", { name: "Retry save", exact: true })
        .waitFor();
      await reply
        .getByRole("button", { name: "Close thread", exact: true })
        .click();
      await repeated
        .getByRole("button", { name: "Retry save", exact: true })
        .waitFor();
      await openReplies.click();
      await replyTodo
        .getByRole("button", { name: "Retry save", exact: true })
        .click();
      await replyTodo
        .getByRole("button", { name: "Retry save", exact: true })
        .waitFor({ state: "hidden" });
      const confirmed = await mobile(id, "dashboard/chat?key=weekend");
      assert.equal(
        confirmed.widgets[0].blocks[0].items.filter(
          (item: { label: string }) =>
            item.label === "Retry this inline tracker task",
        ).length,
        1,
      );
      assert.equal(responseDropped, true);
      await page.unroute("**/*");
      await replyTodo
        .getByRole("button", {
          name: "Delete task Retry this inline tracker task",
          exact: true,
        })
        .click();
      await replyTodo
        .getByRole("checkbox", {
          name: "Retry this inline tracker task",
          exact: true,
        })
        .waitFor({ state: "hidden" });
    }
    await unchangedRuns(id);
    await geometry(page);
    await replyTodo.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(output, `${responseStyle}-${label}-reply-todo.png`),
    });
    await replyMeal.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(output, `${responseStyle}-${label}-reply-calories.png`),
    });

    await page.reload();
    await replyMeal.getByText("1,210", { exact: true }).waitFor();
    assert.equal(await replyComposer.inputValue(), "Keep my reply draft too");
    await reply
      .getByRole("button", { name: "Close thread", exact: true })
      .click();
    await repeated
      .getByRole("checkbox", { name: "Plan the next hike", exact: true })
      .waitFor();
    assert.equal(await composer.inputValue(), "Keep my unsent chat draft");
    const inline = await mobile(id, "dashboard/chat?key=weekend");
    const dashboard = await mobile(id, "dashboard");
    assert.equal(inline.widgets.length, 1);
    assert.deepEqual(
      inline.widgets[0],
      dashboard.widgets.find((item: { key: string }) => item.key === "weekend"),
    );
    await page.goto(`${base}/agents/${id}/dashboard`);
    const saved = page
      .getByRole("article", { name: "Weekend checklist", exact: true })
      .first();
    await saved
      .getByRole("checkbox", { name: "Plan the next hike", exact: true })
      .waitFor();
    await page
      .getByRole("article", { name: "Meals today", exact: true })
      .first()
      .getByText("1,210", { exact: true })
      .waitFor();
    await unchangedRuns(id);
    assert.deepEqual(errors, []);
    console.log(
      `${responseStyle}/${label}: main + reply inline edits, shared current data, drafts, real tools, persistence and geometry passed`,
    );
    await context.close();
  }

  const fixture = cases[0]!;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  currentPage = page;
  const current = (await run(listDashboards(fixture.id))).find(
    (item) => item.key === "weekend",
  )!;
  await run(
    deleteDashboard(fixture.id, {
      key: current.key,
      expectedRevision: current.revision,
    }),
  );
  await page.goto(`${base}/agents/${fixture.id}`);
  await page
    .getByText("This tracker is no longer available.", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("article", { name: "Weekend checklist", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("article", { name: "Meals today", exact: true })
    .waitFor();
  await run(setDashboardPreference(false));
  await page.reload();
  await page
    .getByText("Dashboards are disabled.", { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Add task", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Log meal", exact: true }).count(),
    0,
  );
  await unchangedRuns(fixture.id);
  await geometry(page);
  console.log(
    "deleted and disabled inline references remain readable and non-interactive",
  );
} catch (error) {
  console.error(error);
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({
      path: join(output, "chat-tracker-failure.png"),
    });
    console.error((await currentPage.locator("body").innerText()).slice(-5000));
  }
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
