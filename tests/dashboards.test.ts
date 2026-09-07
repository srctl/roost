import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import type { SaveDashboard } from "../src/features/dashboards/schema";
import { saveAgent } from "../src/server/agents/store.server";
import {
  deleteDashboard,
  getDashboardPreference,
  listDashboards,
  saveDashboard,
  setDashboardPreference,
} from "../src/server/dashboards/store.server";

const run = Effect.runPromise;
const create = () =>
  run(
    saveAgent({
      id: randomUUID(),
      name: "Tracker",
      instructions: "Help",
      character: "moss",
      model: "fake",
    }),
  );
const content: SaveDashboard = {
  key: "project-status",
  title: "Project status",
  blocks: [
    { type: "markdown", text: "## Next up\nReview the release." },
    {
      type: "metrics",
      items: [{ label: "Remaining", value: "3", note: "From the task list" }],
    },
    { type: "table", columns: ["Area", "Status"], rows: [["App", "Ready"]] },
    {
      type: "chart",
      title: "Completed each week",
      style: "line",
      points: [
        { label: "Aug 31", value: 2 },
        { label: "Sep 7", value: 5 },
      ],
    },
    {
      type: "links",
      items: [{ label: "Source", url: "https://example.com/project" }],
    },
    { type: "tasks", items: [{ label: "Review release", status: "doing" }] },
  ],
};

async function fixture(task: () => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-dashboards-test-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  try {
    await task();
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

test("dashboards default off, gate every content operation, and preserve saved content when disabled", async () =>
  fixture(async () => {
    const agent = await create();
    assert.deepEqual(await run(getDashboardPreference()), { enabled: false });
    await assert.rejects(run(listDashboards(agent.id)), /Dashboards are off/);
    await assert.rejects(
      run(saveDashboard(agent.id, content)),
      /Dashboards are off/,
    );
    await assert.rejects(
      run(deleteDashboard(agent.id, { key: content.key, expectedRevision: 1 })),
      /Dashboards are off/,
    );
    await run(setDashboardPreference(true));
    const saved = await run(saveDashboard(agent.id, content));
    assert.deepEqual((await run(listDashboards(agent.id)))[0], saved);
    await run(setDashboardPreference(false));
    assert.deepEqual(await run(getDashboardPreference()), { enabled: false });
    await assert.rejects(run(listDashboards(agent.id)), /Dashboards are off/);
    await assert.rejects(
      run(
        saveDashboard(agent.id, {
          ...content,
          expectedRevision: saved.revision,
        }),
      ),
      /Dashboards are off/,
    );
    await assert.rejects(
      run(
        deleteDashboard(agent.id, {
          key: content.key,
          expectedRevision: saved.revision,
        }),
      ),
      /Dashboards are off/,
    );
    await run(setDashboardPreference(true));
    assert.deepEqual(await run(listDashboards(agent.id)), [saved]);
  }));

test("stable dashboard keys are scoped to an agent and stale updates cannot overwrite changes", async () =>
  fixture(async () => {
    const owner = await create();
    const other = await create();
    await run(setDashboardPreference(true));
    const first = await run(saveDashboard(owner.id, content));
    await assert.rejects(run(saveDashboard(owner.id, content)), /changed/);
    await assert.rejects(
      run(
        saveDashboard(other.id, {
          ...content,
          expectedRevision: first.revision,
        }),
      ),
      /changed/,
    );
    await assert.rejects(
      run(
        deleteDashboard(other.id, {
          key: content.key,
          expectedRevision: first.revision,
        }),
      ),
      /changed/,
    );
    assert.deepEqual(await run(listDashboards(other.id)), []);
    const otherWidget = await run(
      saveDashboard(other.id, { ...content, title: "Other tracker" }),
    );
    const changed = await run(
      saveDashboard(owner.id, {
        ...content,
        title: "Updated",
        expectedRevision: first.revision,
      }),
    );
    assert.equal(changed.revision, 2);
    await assert.rejects(
      run(
        saveDashboard(owner.id, {
          ...content,
          expectedRevision: first.revision,
        }),
      ),
      /changed/,
    );
    await assert.rejects(
      run(
        deleteDashboard(owner.id, {
          key: content.key,
          expectedRevision: first.revision,
        }),
      ),
      /changed/,
    );
    assert.deepEqual(await run(listDashboards(owner.id)), [changed]);
    assert.deepEqual(await run(listDashboards(other.id)), [otherWidget]);
    await assert.rejects(run(listDashboards(randomUUID())), /Agent not found/);
    await run(
      deleteDashboard(owner.id, {
        key: content.key,
        expectedRevision: changed.revision,
      }),
    );
    assert.deepEqual(await run(listDashboards(owner.id)), []);
    assert.deepEqual(await run(listDashboards(other.id)), [otherWidget]);
  }));

test("native blocks reject executable links, malformed tables, nonfinite charts, and unbounded reports", async () =>
  fixture(async () => {
    const agent = await create();
    await run(setDashboardPreference(true));
    for (const blocks of [
      [
        {
          type: "links",
          items: [{ label: "Bad", url: "javascript:alert(1)" }],
        },
      ],
      [{ type: "table", columns: ["A", "B"], rows: [["only one"]] }],
      [
        {
          type: "chart",
          title: "Bad",
          style: "line",
          points: [{ label: "x", value: Infinity }],
        },
      ],
      [{ type: "html", html: "<script>alert(1)</script>" }],
      Array.from({ length: 13 }, () => ({ type: "markdown", text: "x" })),
    ])
      await assert.rejects(
        run(saveDashboard(agent.id, { ...content, blocks } as SaveDashboard)),
      );
    assert.deepEqual(await run(listDashboards(agent.id)), []);
  }));
