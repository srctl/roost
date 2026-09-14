import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect, JSONSchema, Schema } from "effect";
import { chartDataError } from "../src/features/dashboards/chart-data";
import {
  type DashboardDataset,
  DatasetChart,
  SaveDataset,
} from "../src/features/dashboards/schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  agentTools,
  handleAgentTool,
} from "../src/server/codex/agent-tools.server";
import {
  deleteDataset,
  listDashboards,
  listDatasets,
  saveDashboard,
  saveDataset,
  setDashboardPreference,
} from "../src/server/dashboards/store.server";

const run = Effect.runPromise;
const data: typeof SaveDataset.Type = {
  key: "weekly",
  title: "Weekly data",
  columns: [
    { key: "week", label: "Week", type: "string" },
    { key: "completed", label: "Completed", type: "number" },
    { key: "planned", label: "Planned", type: "number" },
  ],
  rows: [
    ["Week 1", 6, 8],
    ["Week 2", 9, 10],
  ],
};
const chart: typeof DatasetChart.Type = {
  type: "dataset-chart",
  title: "Delivery",
  datasetKey: "weekly",
  style: "line",
  x: "week",
  series: [
    { column: "completed", label: "Completed" },
    { column: "planned", label: "Planned" },
  ],
};
async function fixture(task: (owner: string, other: string) => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-datasets-test-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids)
      await run(
        saveAgent({
          id,
          name: "Charts",
          instructions: "Help",
          character: "moss",
          model: "fake",
        }),
      );
    await task(ids[0]!, ids[1]!);
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}
test("datasets default off, are agent-scoped, revision checked, and preserved when disabled", () =>
  fixture(async (owner, other) => {
    await assert.rejects(run(listDatasets(owner)), /Dashboards are off/);
    await assert.rejects(run(saveDataset(owner, data)), /Dashboards are off/);
    await assert.rejects(
      run(deleteDataset(owner, { key: data.key, expectedRevision: 1 })),
      /Dashboards are off/,
    );
    await run(setDashboardPreference(true));
    const first = await run(saveDataset(owner, data));
    assert.equal(first.revision, 1);
    assert.deepEqual(await run(listDatasets(other)), []);
    await assert.rejects(
      run(saveDataset(other, { ...data, expectedRevision: 1 })),
      /changed/,
    );
    await assert.rejects(
      run(deleteDataset(other, { key: data.key, expectedRevision: 1 })),
      /changed/,
    );
    await assert.rejects(
      run(
        saveDashboard(other, {
          key: "report",
          title: "Report",
          blocks: [chart],
        }),
      ),
      /missing/,
    );
    await run(saveDataset(other, { ...data, title: "Other" }));
    await assert.rejects(run(saveDataset(owner, data)), /changed/);
    const updated = await run(
      saveDataset(owner, {
        ...data,
        rows: [["Week 1", 10, 12]],
        expectedRevision: 1,
      }),
    );
    assert.equal(updated.revision, 2);
    await assert.rejects(
      run(saveDataset(owner, { ...data, expectedRevision: 1 })),
      /changed/,
    );
    await assert.rejects(
      run(deleteDataset(owner, { key: data.key, expectedRevision: 1 })),
      /changed/,
    );
    await run(setDashboardPreference(false));
    for (const op of [
      listDatasets(owner),
      saveDataset(owner, { ...data, expectedRevision: 2 }),
      deleteDataset(owner, { key: data.key, expectedRevision: 2 }),
    ])
      await assert.rejects(run(op), /Dashboards are off/);
    await run(setDashboardPreference(true));
    assert.deepEqual(await run(listDatasets(owner)), [updated]);
    await run(deleteDataset(owner, { key: data.key, expectedRevision: 2 }));
    assert.deepEqual(await run(listDatasets(owner)), []);
    assert.equal((await run(listDatasets(other))).length, 1);
    await assert.rejects(run(listDatasets(randomUUID())), /Agent not found/);
  }));
test("typed datasets and chart specifications enforce bounded, non-executable schemas", () => {
  const decode = Schema.decodeUnknownSync(SaveDataset);
  for (const invalid of [
    { ...data, key: "../escape" },
    { ...data, columns: [data.columns[0], data.columns[0]] },
    { ...data, rows: [["short"]] },
    { ...data, rows: [["Week 1", "6", 8]] },
    { ...data, rows: [["Week 1", Infinity, 8]] },
    { ...data, rows: [["Week 1", NaN, 8]] },
    { ...data, rows: Array.from({ length: 201 }, () => ["week", 1, 2]) },
    { ...data, columns: Array.from({ length: 9 }, () => data.columns[0]) },
    { ...data, sourceUrl: "javascript:alert(1)" },
    {
      ...data,
      rows: Array.from({ length: 200 }, () => ["x".repeat(1000), 1, 2]),
    },
    { ...data, expectedRevision: 0 },
  ])
    assert.throws(() => decode(invalid));
  assert.doesNotThrow(() => decode({ ...data, rows: [["Week 1", null, 1]] }));
  assert.doesNotThrow(() => decode({ ...data, rows: [] }));
  for (const invalid of [
    { ...chart, style: "script" },
    { ...chart, series: [] },
    { ...chart, series: [chart.series[0], chart.series[0]] },
    { ...chart, style: "donut" },
  ])
    assert.throws(() => Schema.decodeUnknownSync(DatasetChart)(invalid));
  assert.doesNotThrow(() => JSONSchema.make(SaveDataset));
  assert.doesNotThrow(() => JSONSchema.make(DatasetChart));
});
test("chart references and source updates validate atomically; sources in use cannot be removed", () =>
  fixture(async (owner) => {
    await run(setDashboardPreference(true));
    await run(saveDataset(owner, data));
    const widget = await run(
      saveDashboard(owner, { key: "report", title: "Report", blocks: [chart] }),
    );
    for (const invalid of [
      {
        ...data,
        columns: [
          { ...data.columns[0]!, key: "renamed" },
          ...data.columns.slice(1),
        ],
      },
      { ...data, rows: [["Week 1", null, 1]] },
    ])
      await assert.rejects(
        run(saveDataset(owner, { ...invalid, expectedRevision: 1 })),
      );
    assert.equal((await run(listDatasets(owner)))[0]?.revision, 1);
    await assert.rejects(
      run(deleteDataset(owner, { key: data.key, expectedRevision: 1 })),
      /used by a chart/,
    );
    const updated = await run(
      saveDataset(owner, {
        ...data,
        rows: [["Week 1", 12, 15]],
        expectedRevision: 1,
      }),
    );
    assert.equal(updated.revision, 2);
    assert.deepEqual(await run(listDashboards(owner)), [widget]);
    await run(
      saveDashboard(owner, {
        key: "report",
        title: "Report",
        blocks: [{ type: "markdown", text: "No chart" }],
        expectedRevision: 1,
      }),
    );
    await run(deleteDataset(owner, { key: data.key, expectedRevision: 2 }));
  }));
test("chart mappings distinguish signed, empty, missing, categorical, and scatter data", () => {
  const dataset: DashboardDataset = {
    ...data,
    agentId: randomUUID(),
    revision: 1,
    updatedAt: 0,
  };
  assert.match(chartDataError(chart, undefined)!, /missing/);
  assert.equal(chartDataError(chart, dataset), null);
  assert.equal(chartDataError(chart, { ...dataset, rows: [] }), null);
  assert.match(
    chartDataError({ ...chart, x: "absent" }, dataset)!,
    /column is missing/,
  );
  assert.match(
    chartDataError(
      { ...chart, series: [{ column: "week", label: "Bad" }] },
      dataset,
    )!,
    /numeric/,
  );
  assert.match(
    chartDataError({ ...chart, style: "scatter" }, dataset)!,
    /numeric x/,
  );
  assert.equal(
    chartDataError({ ...chart, style: "scatter", x: "planned" }, dataset),
    null,
  );
  const negative = { ...dataset, rows: [["Week 1", -4, 2]] };
  for (const style of ["line", "bar", "scatter"] as const)
    assert.equal(
      chartDataError(
        { ...chart, style, x: style === "scatter" ? "planned" : "week" },
        negative,
      ),
      null,
    );
  for (const style of ["area", "stacked-bar", "donut"] as const)
    assert.match(chartDataError({ ...chart, style }, negative)!, /nonnegative/);
  assert.match(
    chartDataError(
      { ...chart, style: "donut", series: [chart.series[0]!] },
      { ...dataset, rows: [["Week 1", 0, 0]] },
    )!,
    /positive/,
  );
  assert.match(
    chartDataError(
      { ...chart, style: "bar" },
      { ...dataset, rows: [dataset.rows[0]!, dataset.rows[0]!] },
    )!,
    /unique category/,
  );
});
test("dataset caps, maintenance gate, and invalid storage writes", () =>
  fixture(async (owner) => {
    await run(setDashboardPreference(true));
    await assert.rejects(run(saveDataset(owner, { ...data, rows: [["bad"]] })));
    assert.deepEqual(await run(listDatasets(owner)), []);
    for (let i = 0; i < 30; i++)
      await run(saveDataset(owner, { ...data, key: `source-${i}` }));
    await assert.rejects(
      run(saveDataset(owner, { ...data, key: "overflow" })),
      /30 data sources/,
    );
    await run(
      saveDataset(owner, { ...data, key: "source-0", expectedRevision: 1 }),
    );
    await run(
      withAgentStore((db) =>
        db.exec("UPDATE runtime_control SET maintenance=1"),
      ),
    );
    await assert.rejects(run(listDatasets(owner)), /maintenance|updat/i);
    await assert.rejects(run(saveDataset(owner, data)), /maintenance|updat/i);
    await assert.rejects(
      run(deleteDataset(owner, { key: "source-0", expectedRevision: 2 })),
      /maintenance|updat/i,
    );
  }));
test("agent tool schemas and dispatch bind data access to runtime owner and exclude reflections", () =>
  fixture(async (owner, other) => {
    await run(setDashboardPreference(true));
    for (const name of [
      "roost_list_datasets",
      "roost_save_dataset",
      "roost_delete_dataset",
    ])
      assert.ok(agentTools.some((tool) => tool.name === name));
    const response = await handleAgentTool(
      { agentId: owner, allowMutations: true },
      "roost_save_dataset",
      { ...data, agentId: other },
    );
    assert.equal(response.success, true);
    assert.equal((await run(listDatasets(owner))).length, 1);
    assert.deepEqual(await run(listDatasets(other)), []);
    const denied = await handleAgentTool(
      { agentId: owner, allowMutations: "reflection" },
      "roost_save_dataset",
      { ...data, key: "forbidden" },
    );
    assert.equal(denied.success, false);
    assert.equal((await run(listDatasets(owner))).length, 1);
  }));

test("v8 migration preserves legacy boards and disabled preference", () =>
  fixture(async (owner) => {
    await run(setDashboardPreference(true));
    const original = await run(
      saveDashboard(owner, {
        key: "old",
        title: "Old board",
        blocks: [
          {
            type: "chart",
            title: "Old",
            style: "line",
            points: [{ label: "x", value: 2 }],
          },
        ],
      }),
    );
    await run(setDashboardPreference(false));
    await run(
      withAgentStore((db) =>
        db.exec(
          `${readFileSync(
            new URL("./fixtures/remove-thread-schema.sql", import.meta.url),
            "utf8",
          )}DROP TABLE dashboard_datasets; PRAGMA user_version=8`,
        ),
      ),
    );
    await assert.rejects(run(listDatasets(owner)), /Dashboards are off/);
    await run(setDashboardPreference(true));
    assert.deepEqual(await run(listDashboards(owner)), [original]);
    assert.deepEqual(await run(listDatasets(owner)), []);
  }));
