import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import { saveAgent } from "../src/server/agents/store.server";
import {
  createCodingJob,
  getCodingJob,
  updateCodingJob,
} from "../src/server/coding/store.server";
import {
  saveDashboard,
  saveDataset,
} from "../src/server/dashboards/store.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";
import { readNote } from "../src/server/notes/store.server";

test("mobile workspaces share real stores, enforce ownership and revisions, and preserve worker request identity", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-workspaces-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const run = Effect.runPromise;
  const tokens = new MobileTokens(directory);
  const device = tokens.create("Workspace test");
  const handle = createMobileHandler(async () => {});
  const request = async (path: string, data?: unknown, authorized = true) => {
    const response = await handle(
      new Request(`https://roost.example/api/mobile/v1/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(authorized ? { Authorization: `Bearer ${device.secret}` } : {}),
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
    );
    assert.ok(response);
    return { status: response.status, value: await response.json() };
  };
  try {
    const agent = await run(
      saveAgent({
        id: randomUUID(),
        name: "Coding",
        instructions: "Help",
        model: "fixture",
        character: "wisp",
        kind: "coding",
      }),
    );
    const other = await run(
      saveAgent({
        id: randomUUID(),
        name: "Other",
        instructions: "Help",
        model: "fixture",
        character: "moss",
      }),
    );
    const path = `agents/${agent.id}`;
    for (const section of ["dashboard", "jobs", "note"])
      assert.equal(
        (await request(`${path}/${section}`, undefined, false)).status,
        401,
      );
    assert.equal((await request(`${path}/dashboard`)).value.enabled, false);
    assert.equal(
      (await request(`${path}/dashboard`, { enabled: "yes" })).status,
      400,
    );
    assert.equal(
      (await request(`${path}/dashboard`, { enabled: true })).status,
      200,
    );
    await run(
      saveDataset(agent.id, {
        key: "trend",
        title: "Trend",
        columns: [
          { key: "day", label: "Day", type: "string" },
          { key: "n", label: "Value", type: "number" },
        ],
        rows: [
          ["Mon", 2],
          ["Tue", 4],
        ],
      }),
    );
    await run(
      saveDashboard(agent.id, {
        key: "trend",
        title: "Trend",
        blocks: [
          {
            type: "dataset-chart",
            title: "Growth",
            datasetKey: "trend",
            style: "line",
            x: "day",
            series: [{ column: "n", label: "Value" }],
          },
        ],
      }),
    );
    const dashboard = (await request(`${path}/dashboard`)).value;
    assert.equal(dashboard.datasets.length, 1);
    assert.equal(dashboard.widgets[0].blocks[0].chartError, null);
    assert.equal(
      (await request(`agents/${other.id}/dashboard`)).value.widgets.length,
      0,
    );

    const note = `${path}/note`;
    assert.equal((await request(note)).value.revision, 0);
    const content = [
      {
        id: randomUUID(),
        type: "paragraph",
        content: [{ text: "Shared with the agent", bold: true }],
      },
    ];
    const write = {
      requestId: randomUUID(),
      revision: 0,
      blocks: content,
      agentId: other.id,
    };
    const first = await request(note, write);
    assert.equal(first.status, 200);
    assert.equal(first.value.revision, 1);
    assert.deepEqual((await request(note, write)).value, first.value);
    assert.deepEqual((await run(readNote(agent.id))).blocks, content);
    assert.equal((await run(readNote(other.id))).revision, 0);
    assert.equal((await request(note, { ...write, blocks: [] })).status, 400);
    const conflict = await request(note, { ...write, requestId: randomUUID() });
    assert.equal(conflict.status, 409);
    assert.match(conflict.value.error, /NOTE_CONFLICT/);
    assert.equal(
      (
        await request(`${note}/instructions`, {
          requestId: randomUUID(),
          revision: 1,
          instructions: "Keep decisions current",
        })
      ).value.revision,
      2,
    );
    const changed = await request(note, {
      requestId: randomUUID(),
      revision: 2,
      blocks: [],
    });
    assert.equal(changed.value.revision, 3);
    const restored = await request(`${note}/restore`, {
      requestId: randomUUID(),
      revision: 3,
      targetRevision: 1,
    });
    assert.deepEqual(restored.value.blocks, content);
    assert.equal(restored.value.instructions, "Keep decisions current");
    assert.equal((await request(`${note}/1`)).value.revision, 1);
    assert.equal((await request(`agents/${other.id}/note/1`)).status, 400);
    assert.equal((await request(`${note}/history?before=2`)).value.length, 2);
    assert.equal((await request(`${note}/history?before=-1`)).status, 400);
    assert.equal(
      (
        await request(note, {
          requestId: randomUUID(),
          revision: 4,
          blocks: [
            {
              ...content[0],
              content: [{ text: "bad", href: "javascript:alert(1)" }],
            },
          ],
        })
      ).status,
      400,
    );

    const id = randomUUID();
    await run(
      createCodingJob({
        id,
        agentId: agent.id,
        title: "Native workspace",
        brief: "Improve the app",
        cwd: directory,
        sessionName: "fixture",
        workerName: "fixture",
        workerKind: "codex",
      }),
    );
    await run(
      updateCodingJob(agent.id, id, {
        status: "review",
        sessionIdentity: "fixture",
        nativeSessionId: "fixture-native",
        lastWorkerState: "idle",
      }),
    );
    const jobPath = `${path}/jobs/${id}`;
    assert.equal((await request(`${path}/jobs`)).value[0].id, id);
    assert.equal((await request(`agents/${other.id}/jobs/${id}`)).status, 400);
    const message = {
      requestId: randomUUID(),
      text: "Make the title larger",
      agentId: other.id,
      id: randomUUID(),
    };
    assert.equal((await request(`${jobPath}/messages`, message)).status, 200);
    assert.equal((await request(`${jobPath}/messages`, message)).status, 200);
    assert.equal(
      (await request(`${jobPath}/messages`, { ...message, text: "Different" }))
        .status,
      400,
    );
    assert.equal((await request(jobPath)).value.messages.length, 1);
    const feedback = {
      requestId: randomUUID(),
      text: "A little more spacing",
      previewRevision: "v1",
    };
    assert.equal((await request(`${jobPath}/feedback`, feedback)).status, 200);
    assert.equal((await request(`${jobPath}/feedback`, feedback)).status, 200);
    assert.equal((await request(jobPath)).value.feedback.length, 1);
    const continuationJob = randomUUID();
    await run(
      createCodingJob({
        id: continuationJob,
        agentId: agent.id,
        title: "Feedback only",
        brief: "Continue this assignment",
        cwd: directory,
        sessionName: "second-fixture",
        workerName: "second-fixture",
        workerKind: "codex",
      }),
    );
    const ready = await run(
      updateCodingJob(agent.id, continuationJob, {
        status: "review",
        sessionIdentity: "second-fixture",
        nativeSessionId: "second-native",
        lastWorkerState: "idle",
      }),
    );
    const secondPath = `${path}/jobs/${continuationJob}`;
    const selected = {
      requestId: randomUUID(),
      text: "Increase spacing",
      previewRevision: "v2",
    };
    assert.equal(
      (await request(`${secondPath}/feedback`, selected)).status,
      200,
    );
    const continuation = {
      requestId: randomUUID(),
      revision: ready.revision,
      messageIds: [selected.requestId],
    };
    assert.equal(
      (
        await request(`${secondPath}/continue`, {
          ...continuation,
          revision: 0,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`${secondPath}/continue`, continuation)).status,
      200,
    );
    assert.equal(
      (await request(`${secondPath}/continue`, continuation)).status,
      200,
    );
    assert.equal(
      (await request(secondPath)).value.feedback[0].inputId,
      continuation.requestId,
    );
    assert.equal(
      (await request(`agents/${other.id}/jobs/${id}/stop`, {})).status,
      400,
    );
    assert.equal((await request(`${jobPath}/stop`, {})).status, 200);
    assert.equal((await run(getCodingJob(agent.id, id))).cancelRequested, true);
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
