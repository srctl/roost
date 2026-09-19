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
import { dashboardPlanForFocus } from "../../src/features/dashboards/presentation";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import {
  readDashboard,
  updateDashboardPresentation,
} from "../../src/server/dashboards/presentation.server";
import {
  saveDashboard,
  saveDataset,
  setDashboardPreference,
} from "../../src/server/dashboards/store.server";
import { MobileTokens } from "../../src/server/mobile/tokens.server";

// Real browser + built server + disposable stores. No live URL, credentials or model calls.
const directory = mkdtempSync(join(tmpdir(), "roost-dashboard-browser-"));
process.env.ROOST_DATA_DIR = directory;
writeFileSync(
  join(directory, "auth.json"),
  JSON.stringify({ OPENAI_API_KEY: "fixture" }),
);
const run = Effect.runPromise;
const id = randomUUID();
await run(
  saveAgent({
    id,
    name: "Moss",
    character: "moss",
    model: "fixture",
    instructions: "Local browser fixture",
  }),
);
await run(
  withAgentStore((db) => {
    db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
  }),
);
await run(setDashboardPreference(true));
await run(
  saveDataset(id, {
    key: "weekly",
    title: "Activity records",
    columns: [
      { key: "day", label: "Day", type: "string" },
      { key: "count", label: "Count", type: "number" },
    ],
    rows: [
      ["Monday", 3],
      ["Tuesday", 5],
    ],
  }),
);
await run(
  saveDashboard(id, {
    key: "garden",
    title: "Garden overview",
    blocks: [
      { type: "metrics", items: [{ label: "Healthy plants", value: "8" }] },
      { type: "markdown", text: "A little care, every day." },
      {
        type: "chart",
        title: "Weekly growth",
        style: "bar",
        points: [
          { label: "Monday", value: 3 },
          { label: "Tuesday", value: 5 },
        ],
      },
      {
        type: "table",
        columns: ["Plant", "Water"],
        rows: [["Basil", "Today"]],
      },
      { type: "tasks", items: [{ label: "Water the basil", status: "todo" }] },
    ],
  }),
);
await run(
  saveDashboard(id, {
    key: "launch",
    title: "Launch checklist",
    blocks: [
      { type: "metrics", items: [{ label: "Launch readiness", value: "75%" }] },
      {
        type: "tasks",
        items: [{ label: "Review the release", status: "todo" }],
      },
      {
        type: "chart",
        title: "Release progress",
        style: "bar",
        points: [{ label: "This week", value: 75 }],
      },
    ],
  }),
);
const tokens = new MobileTokens(directory);
const device = tokens.create("Browser integration test");
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
    ["desktop-light", 1440, 960, "light"],
    ["phone-dark", 390, 844, "dark"],
    ["narrow-phone", 320, 700, "light"],
  ] as const) {
    const snapshot = await (await mobile("dashboard")).json();
    assert.equal(
      (
        await mobile("dashboard/presentation", {
          intent: "",
          revision: snapshot.presentation.revision,
        })
      ).status,
      200,
    );
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/agents/${id}/dashboard`);
    await page.getByLabel("View", { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Describe a view" }).count(),
      0,
    );
    await page.getByText("Healthy plants", { exact: true }).waitFor();
    await page.getByLabel("View", { exact: true }).selectOption("charts");
    await page.getByRole("button", { name: "Reset view" }).waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Updating view" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.getByText("Healthy plants", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText("Water the basil", { exact: true }).count(),
      0,
    );
    await page.getByText("Weekly growth", { exact: true }).waitFor();
    assert.equal(
      (await (await mobile("dashboard")).json()).presentation.focus,
      "charts",
    );
    await page.reload();
    await page.getByText("Weekly growth", { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel("View", { exact: true }).inputValue(),
      "charts",
    );
    await page.screenshot({
      path: join(output, `${label}-charts.png`),
      fullPage: true,
    });
    await page.getByLabel("View", { exact: true }).selectOption("tasks");
    await page.getByText("Water the basil", { exact: true }).waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Updating view" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.getByText("Weekly growth", { exact: true }).count(),
      0,
    );
    // A native client updates the same persisted selection. A stale web request loses cleanly.
    const current = await (await mobile("dashboard")).json();
    assert.equal(
      (
        await mobile("dashboard/presentation", {
          focus: "tables",
          revision: current.presentation.revision,
        })
      ).status,
      200,
    );
    await page.getByLabel("View", { exact: true }).selectOption("summary");
    await page.getByRole("alert").waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Updating view" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.getByLabel("View", { exact: true }).inputValue(),
      "tables",
    );
    await page.getByRole("button", { name: "Reset view" }).click();
    await page.getByText("Healthy plants", { exact: true }).waitFor();
    await page.getByText("Water the basil", { exact: true }).waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Updating view" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: join(output, `${label}-all.png`),
      fullPage: true,
    });
    // Exercise scoped persistence with an injected deterministic planner. The built
    // server still has no planner credentials; it renders the real saved contract.
    const beforeScope = await run(readDashboard(id));
    const previousKey = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "local-planner-fixture";
    try {
      await run(
        updateDashboardPresentation(
          id,
          {
            intent: "Show my garden progress",
            revision: beforeScope.presentation.revision,
          },
          {
            planner: async () =>
              dashboardPlanForFocus(
                beforeScope.widgets,
                beforeScope.datasets,
                "charts",
                "garden",
              ),
          },
        ),
      );
    } finally {
      if (previousKey === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = previousKey;
    }
    await page.reload();
    await page.getByText("Weekly growth", { exact: true }).waitFor();
    await page
      .getByText("Showing Garden overview.", { exact: false })
      .waitFor();
    assert.equal(
      await page.getByRole("article", { name: "Launch checklist" }).count(),
      0,
    );
    assert.equal(
      (await (await mobile("dashboard")).json()).presentation.widgetKey,
      "garden",
    );
    await page.screenshot({
      path: join(output, `${label}-topic.png`),
      fullPage: true,
    });
    await page.getByLabel("View", { exact: true }).selectOption("summary");
    await page.getByText("Launch readiness", { exact: true }).waitFor();
    assert.equal(
      (await (await mobile("dashboard")).json()).presentation.widgetKey,
      null,
    );
    // Discuss prepares a contextual draft without sending it or replacing an existing draft.
    await page
      .getByRole("article", { name: "Garden overview" })
      .getByRole("button", { name: "Discuss with Moss" })
      .click();
    const composer = page.getByRole("textbox", { name: "Message Moss" });
    await composer.waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Message Moss"]',
        )
        ?.value.includes("key: garden"),
    );
    const gardenDraft = await composer.inputValue();
    assert.ok(
      gardenDraft.includes("unfinished tasks and suggested next steps"),
    );
    await composer.fill("Keep my existing draft");
    if (width <= 1100)
      await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page
      .getByRole("article", { name: "Launch checklist" })
      .getByRole("button", { name: "Discuss with Moss" })
      .click();
    await page
      .getByRole("button", { name: "Add dashboard question" })
      .waitFor();
    assert.equal(await composer.inputValue(), "Keep my existing draft");
    await composer.fill("x".repeat(32000));
    assert.equal(
      await page
        .getByRole("button", { name: "Add dashboard question" })
        .isDisabled(),
      true,
    );
    assert.equal((await composer.inputValue()).length, 32000);
    await composer.fill("Keep my existing draft");
    await page.getByRole("button", { name: "Add dashboard question" }).click();
    assert.ok(
      (await composer.inputValue()).startsWith("Keep my existing draft\n\n"),
    );
    assert.ok((await composer.inputValue()).includes("key: launch"));
    assert.equal(
      (await (await mobile("conversation")).json()).entries.length,
      0,
    );
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${label}: focus, topic scope, reload, shared state, conflict recovery, reset, contextual draft preservation and geometry passed`,
    );
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
