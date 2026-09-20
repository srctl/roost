import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { availableDashboardFocus } from "../src/features/dashboards/presentation";
import {
  DashboardDate,
  SaveDashboard,
} from "../src/features/dashboards/schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import {
  listDashboards,
  saveDashboard,
  setDashboardPreference,
} from "../src/server/dashboards/store.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

const run = Effect.runPromise;

test("interactive dashboards persist authenticated actions with bounded schemas, ownership and safe retries", async (t) => {
  const directory = mkdtempSync("/tmp/roost-dashboard-actions-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const token = tokens.create("Dashboard actions");
  const handle = createMobileHandler(async () => {});
  const makeAgent = (name: string) =>
    run(
      saveAgent({
        id: randomUUID(),
        name,
        instructions: "Help",
        model: "fixture",
        character: "wisp",
      }),
    );
  const agent = await makeAgent("Trackers");
  const other = await makeAgent("Other");
  const request = async (path: string, data?: unknown, authorized = true) => {
    const response = await handle(
      new Request(`https://roost.example/api/mobile/v1/agents/${path}`, {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(authorized ? { Authorization: `Bearer ${token.secret}` } : {}),
          "Content-Type": "application/json",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
    );
    assert.ok(response);
    return { status: response.status, value: await response.json() };
  };
  const create = (data: unknown, owner = agent.id) =>
    request(`${owner}/dashboard/tracker`, data);
  const act = (data: unknown, owner = agent.id) =>
    request(`${owner}/dashboard/action`, data);
  const todo = { key: "my-todos", kind: "todo", title: "My to-dos" };
  const calories = { key: "meals", kind: "calories", title: "Meal log" };
  try {
    await t.test(
      "creation requires authentication, a real agent and enabled dashboards",
      async () => {
        assert.equal(
          (await request(`${agent.id}/dashboard/tracker`, todo, false)).status,
          401,
        );
        assert.equal((await create(todo)).status, 400);
        await run(setDashboardPreference(true));
        assert.equal((await create(todo, randomUUID())).status, 400);
        for (const invalid of [
          { ...todo, kind: "unknown" },
          { ...todo, key: "bad key" },
          { ...todo, title: " " },
          { ...todo, title: "x".repeat(101) },
          { ...todo, agentId: other.id },
        ])
          assert.equal((await create(invalid)).status, 400);
        const first = await create(todo);
        assert.equal(first.status, 200);
        assert.equal(first.value.revision, 1);
        assert.deepEqual(first.value.blocks, [
          { type: "todo-list", id: "items", items: [] },
        ]);
        assert.deepEqual((await create(todo)).value, first.value);
        assert.equal(
          (await create({ ...todo, title: "Different" })).status,
          409,
        );
        assert.equal((await create({ ...todo, kind: "calories" })).status, 409);
        assert.equal((await create(todo, other.id)).status, 200);
        const meal = await create(calories);
        assert.equal(meal.status, 200);
        assert.deepEqual(meal.value.blocks, [
          { type: "calorie-log", id: "items", entries: [] },
        ]);
      },
    );
    await t.test(
      "to-dos add, persist, complete and delete without duplicate retries or lost concurrent edits",
      async () => {
        const id = randomUUID();
        const add = {
          key: todo.key,
          blockId: "items",
          expectedRevision: 1,
          action: "add-todo",
          id,
          label: "  Plan trip  ",
        };
        assert.equal(
          (await request(`${agent.id}/dashboard/action`, add, false)).status,
          401,
        );
        const first = await act(add);
        assert.equal(first.status, 200);
        assert.equal(first.value.revision, 2);
        assert.deepEqual(first.value.blocks[0].items, [
          { id, label: "Plan trip", done: false },
        ]);
        assert.deepEqual((await act(add)).value, first.value);
        const collision = await act({ ...add, label: "Different task" });
        assert.equal(collision.status, 409);
        assert.equal(
          collision.value.error.includes("DASHBOARD_CONFLICT"),
          false,
        );
        const done = await act({
          key: todo.key,
          blockId: "items",
          expectedRevision: 2,
          action: "set-todo",
          id,
          done: true,
        });
        assert.equal(done.status, 200);
        assert.equal(done.value.revision, 3);
        assert.equal(done.value.blocks[0].items[0].done, true);
        const retryAfterEdit = await act(add);
        assert.equal(retryAfterEdit.value.revision, 3);
        assert.equal(retryAfterEdit.value.blocks[0].items[0].done, true);
        assert.equal(
          (
            await act({
              key: todo.key,
              blockId: "items",
              expectedRevision: 2,
              action: "set-todo",
              id,
              done: false,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await act(
              {
                key: todo.key,
                blockId: "items",
                expectedRevision: 1,
                action: "set-todo",
                id,
                done: true,
              },
              other.id,
            )
          ).status,
          409,
        );
        assert.equal((await create(todo)).value.revision, 3);
        const saved = (
          await request(`${agent.id}/dashboard`)
        ).value.widgets.find(
          (widget: { key: string }) => widget.key === todo.key,
        );
        assert.equal(saved.blocks[0].items[0].done, true);
        const deleted = await act({
          key: todo.key,
          blockId: "items",
          expectedRevision: 3,
          action: "delete-todo",
          id,
        });
        assert.equal(deleted.value.revision, 4);
        assert.deepEqual(deleted.value.blocks[0].items, []);
        assert.equal((await act(add)).status, 409);
        assert.equal(
          (
            await act({
              key: todo.key,
              blockId: "items",
              expectedRevision: 3,
              action: "delete-todo",
              id,
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      "calorie entries preserve explicit dates and amounts, reject malformed input, and delete",
      async () => {
        const id = randomUUID();
        const add = {
          key: calories.key,
          blockId: "items",
          expectedRevision: 1,
          action: "add-meal",
          id,
          date: "2024-02-29",
          label: "Lunch",
          calories: 530,
        };
        const first = await act(add);
        assert.equal(first.status, 200);
        assert.deepEqual(first.value.blocks[0].entries, [
          { id, date: "2024-02-29", label: "Lunch", calories: 530 },
        ]);
        assert.deepEqual((await act(add)).value, first.value);
        assert.equal((await act({ ...add, calories: 531 })).status, 409);
        for (const date of [
          "1900-02-29",
          "2026-02-29",
          "2024-04-31",
          "2024-00-01",
          "2024-01-00",
          "0000-01-01",
          "2024-2-9",
          "2024-13-01",
        ]) {
          assert.equal(
            (await act({ ...add, id: randomUUID(), date, expectedRevision: 2 }))
              .status,
            400,
          );
        }
        for (const value of [-1, 20001, 3.5, "530", null])
          assert.equal(
            (
              await act({
                ...add,
                id: randomUUID(),
                calories: value,
                expectedRevision: 2,
              })
            ).status,
            400,
          );
        for (const label of ["", " ", "x".repeat(201)])
          assert.equal(
            (
              await act({
                ...add,
                id: randomUUID(),
                label,
                expectedRevision: 2,
              })
            ).status,
            400,
          );
        assert.equal(
          (await act({ ...add, id: "not-a-uuid", expectedRevision: 2 })).status,
          400,
        );
        assert.equal(
          (
            await act({
              ...add,
              id: randomUUID(),
              agentId: other.id,
              expectedRevision: 2,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await act({
              ...add,
              id: randomUUID(),
              action: "add-todo",
              expectedRevision: 2,
            })
          ).status,
          400,
        );
        assert.equal(
          Schema.decodeUnknownSync(DashboardDate)("2000-02-29"),
          "2000-02-29",
        );
        const zero = await act({
          ...add,
          id: randomUUID(),
          date: "2026-09-19",
          calories: 0,
          expectedRevision: 2,
        });
        assert.equal(zero.status, 200);
        assert.equal(zero.value.revision, 3);
        const deleted = await act({
          key: calories.key,
          blockId: "items",
          expectedRevision: 3,
          action: "delete-meal",
          id,
        });
        assert.equal(deleted.value.revision, 4);
        assert.equal(deleted.value.blocks[0].entries.length, 1);
        assert.equal(deleted.value.blocks[0].entries[0].calories, 0);
      },
    );
    await t.test(
      "composite widgets preserve unrelated blocks and forbid item IDs crossing blocks",
      async () => {
        const duplicateId = randomUUID();
        const saved = await run(
          saveDashboard(agent.id, {
            key: "composite",
            title: "Daily life",
            blocks: [
              { type: "markdown", text: "Keep this context" },
              {
                type: "todo-list",
                id: "todos",
                items: [{ id: duplicateId, label: "Walk", done: false }],
              },
              { type: "calorie-log", id: "food", entries: [] },
            ],
          }),
        );
        const mealId = randomUUID();
        const result = await act({
          key: saved.key,
          blockId: "food",
          expectedRevision: 1,
          action: "add-meal",
          id: mealId,
          date: "2026-09-19",
          label: "Breakfast",
          calories: 400,
        });
        assert.equal(result.status, 200);
        assert.deepEqual(
          result.value.blocks.slice(0, 2),
          saved.blocks.slice(0, 2),
        );
        assert.equal(
          (
            await act({
              key: saved.key,
              blockId: "food",
              expectedRevision: 2,
              action: "add-meal",
              id: duplicateId,
              date: "2026-09-19",
              label: "Walk",
              calories: 1,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await act({
              key: todo.key,
              blockId: "items",
              expectedRevision: 4,
              action: "add-todo",
              id: duplicateId,
              label: "Walk",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await act({
              key: saved.key,
              blockId: "missing",
              expectedRevision: 2,
              action: "add-todo",
              id: randomUUID(),
              label: "New",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await act({
              key: saved.key,
              blockId: "food",
              expectedRevision: 2,
              action: "add-todo",
              id: randomUUID(),
              label: "New",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await act({
              key: "foreign",
              blockId: "items",
              expectedRevision: 1,
              action: "add-todo",
              id: randomUUID(),
              label: "New",
            })
          ).status,
          400,
        );
        assert.deepEqual(availableDashboardFocus([result.value], []), [
          "all",
          "summary",
          "tables",
          "tasks",
        ]);
      },
    );
    await t.test(
      "schema caps and unique IDs apply to agent-authored widgets and user additions",
      async () => {
        const id = randomUUID();
        const base = {
          key: "invalid",
          title: "Invalid",
          blocks: [{ type: "todo-list", id: "items", items: [] }],
        };
        for (const blocks of [
          [
            {
              type: "todo-list",
              id: "items",
              items: [
                { id, label: "A", done: false },
                { id, label: "B", done: false },
              ],
            },
          ],
          [
            { type: "todo-list", id: "items", items: [] },
            { type: "calorie-log", id: "items", entries: [] },
          ],
          [
            {
              type: "todo-list",
              id: "a",
              items: [{ id, label: "A", done: false }],
            },
            {
              type: "calorie-log",
              id: "b",
              entries: [{ id, date: "2026-09-19", label: "B", calories: 1 }],
            },
          ],
          [
            {
              type: "todo-list",
              id: "items",
              items: Array.from({ length: 101 }, () => ({
                id: randomUUID(),
                label: "A",
                done: false,
              })),
            },
          ],
          [
            {
              type: "calorie-log",
              id: "items",
              entries: Array.from({ length: 201 }, () => ({
                id: randomUUID(),
                date: "2026-09-19",
                label: "A",
                calories: 1,
              })),
            },
          ],
          [
            {
              type: "todo-list",
              id: "items",
              items: Array.from({ length: 100 }, () => ({
                id: randomUUID(),
                label: "界".repeat(200),
                done: false,
              })),
            },
          ],
        ])
          assert.throws(() =>
            Schema.decodeUnknownSync(SaveDashboard)({ ...base, blocks }),
          );
        const full = await run(
          saveDashboard(agent.id, {
            key: "full",
            title: "Full",
            blocks: [
              {
                type: "todo-list",
                id: "items",
                items: Array.from({ length: 100 }, () => ({
                  id: randomUUID(),
                  label: "A",
                  done: false,
                })),
              },
            ],
          }),
        );
        assert.equal(
          (
            await act({
              key: full.key,
              blockId: "items",
              expectedRevision: 1,
              action: "add-todo",
              id: randomUUID(),
              label: "One more",
            })
          ).status,
          400,
        );
        assert.equal(
          (await run(listDashboards(agent.id))).find(
            (widget) => widget.key === "full",
          )!.revision,
          1,
        );
      },
    );
    await t.test(
      "concurrent create retries converge and stale simultaneous edits cannot overwrite each other",
      async () => {
        const input = {
          key: "race",
          title: "Concurrent tracker",
          kind: "todo",
        };
        const creations = await Promise.all([create(input), create(input)]);
        assert.deepEqual(
          creations.map((result) => result.status),
          [200, 200],
        );
        assert.deepEqual(creations[0]!.value, creations[1]!.value);
        const first = {
          key: input.key,
          blockId: "items",
          expectedRevision: 1,
          action: "add-todo",
          id: randomUUID(),
          label: "First",
        };
        const second = { ...first, id: randomUUID(), label: "Second" };
        const writes = await Promise.all([act(first), act(second)]);
        assert.deepEqual(
          writes.map((result) => result.status).sort(),
          [200, 409],
        );
        const current = (await run(listDashboards(agent.id))).find(
          (widget) => widget.key === input.key,
        )!;
        assert.equal(current.revision, 2);
        assert.equal(current.blocks[0]!.type, "todo-list");
        if (current.blocks[0]!.type === "todo-list")
          assert.equal(current.blocks[0]!.items.length, 1);
        const winner = writes[0]!.status === 200 ? first : second;
        const retry = await act(winner);
        assert.equal(retry.status, 200);
        assert.equal(retry.value.revision, 2);
      },
    );
    await t.test(
      "maintenance and disabled dashboards reject actions and retries without writes",
      async () => {
        const requestData = {
          key: todo.key,
          blockId: "items",
          expectedRevision: 4,
          action: "add-todo",
          id: randomUUID(),
          label: "Later",
        };
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1")
              .run(),
          ),
        );
        assert.equal((await act(requestData)).status, 400);
        assert.equal((await create(todo)).status, 400);
        await run(
          withAgentStore((db) =>
            db
              .prepare("UPDATE runtime_control SET maintenance=0 WHERE id=1")
              .run(),
          ),
        );
        await run(setDashboardPreference(false));
        assert.equal((await act(requestData)).status, 400);
        assert.equal((await create(todo)).status, 400);
        await run(setDashboardPreference(true));
        assert.equal(
          (await run(listDashboards(agent.id))).find(
            (widget) => widget.key === todo.key,
          )!.revision,
          4,
        );
      },
    );
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
