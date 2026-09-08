import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { chromium } from "playwright";
import type { DatasetChart } from "../src/features/dashboards/schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  saveDashboard,
  saveDataset,
  setDashboardPreference,
} from "../src/server/dashboards/store.server";

const directory = mkdtempSync("/tmp/roost-chart-browser-");
const previous = process.env.ROOST_DATA_DIR;
process.env.ROOST_DATA_DIR = directory;
const run = Effect.runPromise;
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const stamp = Date.UTC(2026, 8, 8, 12);
const source = {
  key: "weekly",
  title: "Weekly delivery data",
  description:
    "Illustrative project data, saved by the agent. Not a live connection.",
  columns: [
    { key: "week", label: "Week", type: "string" as const },
    { key: "completed", label: "Completed", type: "number" as const },
    { key: "planned", label: "Planned", type: "number" as const },
  ],
  rows: [
    ["Week 1", 6, 8],
    ["Week 2", 9, 11],
    ["Week 3", 12, 14],
    ["Week 4", 15, 18],
  ],
};
await run(
  saveAgent({
    id: agentId,
    name: "Project insights",
    instructions: "Track demo project data",
    character: "moss",
    model: "fake",
  }),
);
await run(setDashboardPreference(true));
await run(saveDataset(agentId, source));
await run(
  saveDataset(agentId, {
    ...source,
    key: "empty",
    title: "Awaiting observations",
    rows: [],
  }),
);
const chart = (style: DatasetChart["style"], title: string): DatasetChart => ({
  type: "dataset-chart",
  title,
  datasetKey: "weekly",
  style,
  x: style === "scatter" ? "planned" : "week",
  series:
    style === "donut"
      ? [{ column: "completed", label: "Completed" }]
      : [
          { column: "completed", label: "Completed" },
          { column: "planned", label: "Planned" },
        ],
});
await run(
  saveDashboard(agentId, {
    key: "delivery",
    title: "Delivery overview",
    blocks: [
      {
        type: "metrics",
        items: [
          { label: "Completed", value: "42", note: "Last four weeks" },
          { label: "In progress", value: "8" },
        ],
      },
      {
        ...chart("line", "Weekly delivery"),
        series: [{ column: "completed", label: "Completed" }],
      },
    ],
  }),
);
await run(
  saveDashboard(agentId, {
    key: "gallery",
    title: "Delivery comparisons",
    blocks: [
      chart("bar", "Completed vs planned"),
      chart("stacked-bar", "Weekly workload"),
      chart("area", "Workload by week"),
      chart("donut", "Share of completed work"),
      chart("scatter", "Planned and completed"),
      { ...chart("line", "Empty source"), datasetKey: "empty" },
    ],
  }),
);
await run(
  saveDashboard(agentId, {
    key: "legacy",
    title: "Original inline charts",
    blocks: [
      {
        type: "chart",
        title: "Legacy signed values",
        style: "bar",
        points: [
          { label: "Same", value: -4 },
          { label: "Same", value: 7 },
        ],
      },
    ],
  }),
);
// Simulate a source removed outside the tools to exercise recovery without hiding other widgets.
await run(
  withAgentStore((db) => {
    db.prepare(
      "INSERT INTO dashboards(agentId,key,title,blocks,revision,updatedAt) VALUES(?,?,?,?,1,?)",
    ).run(
      agentId,
      "missing",
      "Unavailable source",
      JSON.stringify([
        { ...chart("line", "Missing source"), datasetKey: "removed" },
      ]),
      stamp - 1,
    );
    db.prepare("UPDATE dashboards SET updatedAt=? WHERE key!='missing'").run(
      stamp,
    );
    db.prepare("UPDATE dashboard_datasets SET updatedAt=?").run(stamp);
  }),
);
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
probe.close();
await once(probe, "close");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("ROOST_") && !key.startsWith("NITRO_"),
  ),
);
Object.assign(env, {
  ROOST_DATA_DIR: directory,
  ROOST_CODEX_BINARY: "/nonexistent-chart-test-codex",
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: String(port),
});
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (chunk) => (logs += chunk));
server.stderr.on("data", (chunk) => (logs += chunk));
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox"],
});
const origin = `http://localhost:${port}`;
try {
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      healthy = (await fetch(`${origin}/api/health`)).ok;
      if (healthy) break;
    } catch {}
    await delay(100);
  }
  assert.ok(healthy, logs);
  // HTML response has an accessible data table before any client-only chart import.
  const html = await (
    await fetch(`${origin}/agents/${agentId}/dashboard`)
  ).text();
  assert.match(html, /Weekly delivery data/);
  assert.match(html, /<table/);
  for (const [size, viewport] of [
    ["desktop", { width: 1440, height: 1100 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    const page = await browser.newPage({
      viewport,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/agents/${agentId}/dashboard`, {
      waitUntil: "networkidle",
    });
    const delivery = page.getByRole("article", {
      name: "Delivery overview",
      exact: true,
    });
    await delivery.locator("svg").waitFor();
    for (const title of [
      "Completed vs planned",
      "Weekly workload",
      "Workload by week",
      "Share of completed work",
      "Planned and completed",
    ]) {
      const figure = page
        .locator("figure")
        .filter({ has: page.locator("figcaption", { hasText: title }) });
      await figure.locator("svg").first().waitFor();
      assert.equal(
        await figure
          .getByText("Chart could not render.", { exact: false })
          .count(),
        0,
      );
    }
    await page.getByText("Data source is missing.", { exact: false }).waitFor();
    await page
      .getByText("No rows saved yet. Ask your agent to add data.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByText("Chart could not render.", { exact: false }).count(),
      0,
    );
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "page must not overflow horizontally",
    );
    if (process.env.CHART_SCREENSHOT_DIR)
      await page.screenshot({
        path: join(process.env.CHART_SCREENSHOT_DIR, `after-${size}.png`),
      });
    const summary = delivery.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await delivery.getByRole("cell", { name: "15", exact: true }).waitFor();
    assert.match(await delivery.innerText(), /Revision 1/);
    if (process.env.CHART_SCREENSHOT_DIR)
      await page.screenshot({
        path: join(process.env.CHART_SCREENSHOT_DIR, `after-data-${size}.png`),
      });
    await summary.press("Enter");
    const catalog = page.getByRole("region", { name: "Saved data sources" });
    await catalog.locator("summary").first().click();
    await catalog
      .getByText("View data: Awaiting observations", { exact: true })
      .click();
    await catalog.getByText("No rows saved yet.", { exact: true }).waitFor();
    await catalog.locator("summary").first().click();
    const grouped = page.locator("figure").filter({
      has: page.locator("figcaption", { hasText: "Completed vs planned" }),
    });
    await grouped.scrollIntoViewIfNeeded();
    // Fluent's keyboard-focusable legends toggle series and recover on the next click.
    const legend = grouped.getByText("Completed", { exact: true }).first();
    await legend.click();
    await legend.click();
    if (process.env.CHART_SCREENSHOT_DIR)
      await page.screenshot({
        path: join(
          process.env.CHART_SCREENSHOT_DIR,
          `after-gallery-${size}.png`,
        ),
      });
    await page.emulateMedia({ colorScheme: "dark" });
    await delay(100);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.setViewportSize({ width: 700, height: 900 });
    await delay(150);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    // The unchanged baseline intermittently reports React 418. All other errors fail.
    assert.deepEqual(
      errors.filter(
        (message) => !message.startsWith("Minified React error #418"),
      ),
      [],
    );
    assert.ok(errors.length <= 1);
    console.log(
      `${size}: six Fluent styles, legacy chart, empty/missing recovery, keyboard tables, data catalog, legends, dark mode, resizing; baseline hydration warnings: ${errors.length}`,
    );
    if (size === "desktop") {
      await run(
        saveDataset(agentId, {
          ...source,
          rows: [["Week 1", 17, 18]],
          expectedRevision: 1,
        }),
      );
      await delivery.locator("summary").click();
      await delivery
        .getByText("Revision 2", { exact: false })
        .waitFor({ timeout: 25000 });
      await delivery.getByRole("cell", { name: "17", exact: true }).waitFor();
      console.log("Polling reflects updated source revisions and values.");
      await run(saveDataset(agentId, { ...source, expectedRevision: 2 }));
      await run(
        withAgentStore((db) =>
          db
            .prepare(
              "UPDATE dashboard_datasets SET revision=1,updatedAt=? WHERE key='weekly'",
            )
            .run(stamp),
        ),
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  if (previous === undefined) delete process.env.ROOST_DATA_DIR;
  else process.env.ROOST_DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
}
