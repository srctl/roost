import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import {
  NavigationChange,
  RenameAgentInput,
} from "../src/features/agents/navigation-schema";
import {
  applyNavigationChange,
  orderedSections,
} from "../src/features/agents/navigation-state";
import {
  changeAgentNavigation,
  readAgentNavigation,
  renameAgent,
} from "../src/server/agents/navigation.server";
import { migrateAgentNavigation } from "../src/server/agents/navigation-migration.server";
import { listAgents, saveAgent } from "../src/server/agents/store.server";

import { createCodingJob } from "../src/server/coding/store.server";
import {
  readNote,
  saveNote,
  saveNoteInstructions,
} from "../src/server/notes/store.server";

const noteTables = [
  "agent_notes",
  "note_revisions",
  "note_requests",
  "note_reads",
];
const dropNavigation =
  "DROP TABLE agent_navigation_layout; DROP TABLE agent_navigation_memberships; DROP TABLE agent_navigation_sections; DROP TABLE agent_navigation_versions;";

const run = Effect.runPromise;

test("core14 navigation installation, rename and sections preserve actual Notes, associated records, private files, IDs and ordering", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-navigation-"));
  try {
    const agent = await run(
      saveAgent(
        {
          id: randomUUID(),
          name: "Scout",
          kind: "coding",
          instructions: "Original soul",
          character: "moss",
          model: "fixture",
        },
        directory,
      ),
    );
    const second = await run(
      saveAgent({ ...agent, id: randomUUID(), name: "Other" }, directory),
    );
    const previous = process.env.ROOST_DATA_DIR;
    process.env.ROOST_DATA_DIR = directory;
    try {
      await run(
        createCodingJob({
          id: randomUUID(),
          agentId: agent.id,
          title: "Preserved job",
          brief: "Keep job references",
          cwd: join(directory, "workspaces", agent.id),
          sessionName: "fixture",
          workerName: "fixture",
          workerKind: "codex",
        }),
      );
      const note = await run(
        saveNote(agent.id, {
          requestId: randomUUID(),
          revision: 0,
          blocks: [
            {
              id: randomUUID(),
              type: "paragraph",
              content: [{ text: "Keep actual Notes" }],
            },
          ],
        }),
      );
      await run(
        saveNoteInstructions(agent.id, {
          requestId: randomUUID(),
          revision: note.revision,
          instructions: "Keep Notes instructions",
        }),
      );
      await run(readNote(agent.id, "preserved-run"));
    } finally {
      if (previous === undefined) delete process.env.ROOST_DATA_DIR;
      else process.env.ROOST_DATA_DIR = previous;
    }
    const files = [
      join(directory, "agents", agent.id, "SOUL.md"),
      join(directory, "agents", agent.id, "codex", "private.json"),
      join(directory, "workspaces", agent.id, "notes.md"),
    ];
    for (const file of files) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "Original private content");
    }
    const db = new DatabaseSync(join(directory, "roost.sqlite"));
    db.prepare("INSERT INTO conversation_sessions VALUES (?,?,?,?,?,?)").run(
      agent.id,
      agent.id,
      "native-thread",
      "[]",
      "codex",
      "fixture",
    );
    db.prepare(
      "INSERT INTO conversation_records(id,agentId,parentConversationId,parentMessageId,createdAt) VALUES (?,?,?,?,?)",
    ).run(randomUUID(), agent.id, agent.id, "message", 1);
    db.prepare(
      "INSERT INTO timeline(id,agentId,conversationId,message) VALUES (?,?,?,?)",
    ).run("message", agent.id, agent.id, '{"role":"user","text":"Keep this"}');
    db.prepare(
      "INSERT INTO runs(id,agentId,kind,prompt,status,createdAt) VALUES (?,?,?,?,?,?)",
    ).run(randomUUID(), agent.id, "chat", "Keep run", "completed", 1);
    db.prepare(
      "INSERT INTO automations(id,agentId,name,prompt,schedule,notification,revision,enabled) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      agent.id,
      "Routine",
      "Keep automation",
      "{}",
      "none",
      1,
      0,
    );
    db.prepare("INSERT INTO coding_job_workspaces VALUES (?,?,?,?,?,?)").run(
      randomUUID(),
      agent.id,
      agent.id,
      '{"notes":"Keep job state"}',
      1,
      1,
    );
    // A foreign feature's table must survive even when this checkout does not own it.
    db.exec(
      "CREATE TABLE notes_preservation_fixture(id TEXT PRIMARY KEY, agentId TEXT, content TEXT)",
    );
    db.prepare("INSERT INTO notes_preservation_fixture VALUES (?,?,?)").run(
      randomUUID(),
      agent.id,
      "Keep note",
    );
    const snapshot = () =>
      Object.fromEntries(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'agent_navigation_%' AND name!='agents' ORDER BY name",
          )
          .all()
          .map((row) => [
            row.name,
            db
              .prepare(
                `SELECT * FROM "${String(row.name).replaceAll('"', '""')}"`,
              )
              .all(),
          ]),
      );
    const coreVersion = db.prepare("PRAGMA user_version").get()?.user_version;
    assert.equal(coreVersion, 14);
    for (const table of noteTables)
      assert.ok(
        Number(db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get()?.n) > 0,
        `${table} contains actual Notes data`,
      );
    const before = snapshot();
    db.exec(dropNavigation);
    const section = randomUUID(),
      other = randomUUID();
    assert.deepEqual(await run(readAgentNavigation(directory)), {
      sections: [],
      memberships: {},
      agentOrder: [agent.id, second.id],
      ungroupedPosition: 0,
    });
    await run(
      renameAgent({ agentId: agent.id, name: "  New Scout  " }, directory),
    );
    const change = (data: NavigationChange) =>
      run(changeAgentNavigation(data, directory));
    await change({ action: "create", id: section, name: " Work " });
    await change({ action: "create", id: other, name: "Personal" });
    await change({ action: "move", agentId: agent.id, sectionId: section });
    await change({ action: "collapse", id: section, collapsed: true });
    await change({ action: "rename", id: section, name: " Projects " });
    assert.deepEqual(await run(readAgentNavigation(directory)), {
      sections: [
        { id: section, name: "Projects", position: 0, collapsed: true },
        { id: other, name: "Personal", position: 1, collapsed: false },
      ],
      memberships: { [agent.id]: section },
      agentOrder: [second.id, agent.id],
      ungroupedPosition: 2,
    });
    await change({ action: "move", agentId: agent.id, sectionId: other });
    assert.deepEqual((await run(readAgentNavigation(directory))).memberships, {
      [agent.id]: other,
    });
    await change({ action: "move", agentId: agent.id, sectionId: null });
    await change({ action: "move", agentId: agent.id, sectionId: section });
    await change({ action: "delete", id: section });
    assert.deepEqual(
      (await run(readAgentNavigation(directory))).memberships,
      {},
    );
    assert.deepEqual(await run(listAgents(directory)), [
      { ...agent, name: "New Scout" },
      second,
    ]);
    assert.deepEqual(snapshot(), before);
    for (const file of files)
      assert.equal(readFileSync(file, "utf8"), "Original private content");
    assert.equal(
      db.prepare("PRAGMA user_version").get()?.user_version,
      coreVersion,
    );
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shared schemas and storage reject invalid names, UUIDs, missing agents/sections atomically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-navigation-validation-"));
  try {
    const agent = await run(
      saveAgent(
        {
          id: randomUUID(),
          name: "Scout",
          instructions: "Soul",
          character: "moss",
          model: "fixture",
        },
        directory,
      ),
    );
    const id = randomUUID();
    await run(
      changeAgentNavigation(
        { action: "create", id, name: "Section" },
        directory,
      ),
    );
    for (const name of ["", " \t\n ", "x".repeat(61)]) {
      assert.throws(() =>
        Schema.decodeUnknownSync(RenameAgentInput)({ agentId: agent.id, name }),
      );
      await assert.rejects(
        run(renameAgent({ agentId: agent.id, name }, directory)),
      );
      for (const action of ["create", "rename"] as const) {
        assert.throws(() =>
          Schema.decodeUnknownSync(NavigationChange)({ action, id, name }),
        );
        await assert.rejects(
          run(changeAgentNavigation({ action, id, name }, directory)),
        );
      }
    }
    await run(
      renameAgent(
        { agentId: agent.id, name: ` ${"x".repeat(60)} ` },
        directory,
      ),
    );
    for (const agentId of ["../outside", randomUUID()]) {
      await assert.rejects(
        run(renameAgent({ agentId, name: "Valid" }, directory)),
      );
      await assert.rejects(
        run(
          changeAgentNavigation(
            { action: "move", agentId, sectionId: id },
            directory,
          ),
        ),
      );
    }
    for (const missing of ["../outside", randomUUID()]) {
      await assert.rejects(
        run(
          changeAgentNavigation(
            { action: "move", agentId: agent.id, sectionId: missing },
            directory,
          ),
        ),
      );
      await assert.rejects(
        run(
          changeAgentNavigation({ action: "delete", id: missing }, directory),
        ),
      );
      await assert.rejects(
        run(
          changeAgentNavigation(
            { action: "collapse", id: missing, collapsed: true },
            directory,
          ),
        ),
      );
    }
    assert.deepEqual(
      (await run(readAgentNavigation(directory))).memberships,
      {},
    );
    assert.equal((await run(listAgents(directory)))[0]?.name, "x".repeat(60));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("feature migration upgrades legacy core13, composes with outer core14 transaction, and refuses future versions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-navigation-upgrade-"));
  try {
    const legacyAgent = await run(
      saveAgent(
        {
          id: randomUUID(),
          name: "Legacy Scout",
          instructions: "Legacy soul",
          character: "moss",
          model: "fixture",
        },
        directory,
      ),
    );
    const db = new DatabaseSync(join(directory, "roost.sqlite"));
    db.exec(
      dropNavigation +
        noteTables.map((table) => `DROP TABLE "${table}";`).join("") +
        "PRAGMA user_version=13",
    );
    const legacyRows = db.prepare("SELECT * FROM agents").all();
    db.exec("BEGIN IMMEDIATE");
    migrateAgentNavigation(db);
    db.exec("PRAGMA user_version=14; ROLLBACK");
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='agent_navigation_versions'",
        )
        .get(),
      undefined,
    );
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 13);
    db.exec("BEGIN IMMEDIATE");
    migrateAgentNavigation(db);
    db.exec("COMMIT");
    // The navigation feature does not advance core's version or install Notes.
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 13);
    db.exec("INSERT INTO agent_navigation_versions VALUES(4)");
    await assert.rejects(
      run(readAgentNavigation(directory)),
      /Agent navigation needs a newer version of Roost/,
    );
    // A late navigation failure must roll back Notes and core14 together.
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 13);
    for (const table of noteTables)
      assert.equal(
        db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table),
        undefined,
      );
    db.exec(
      "DELETE FROM agent_navigation_versions WHERE version=4;" + dropNavigation,
    );
    assert.deepEqual(await run(readAgentNavigation(directory)), {
      sections: [],
      memberships: {},
      agentOrder: [legacyAgent.id],
      ungroupedPosition: 0,
    });
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 14);
    for (const table of noteTables)
      assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get()?.n, 0);
    assert.deepEqual(db.prepare("SELECT * FROM agents").all(), legacyRows);
    assert.equal(
      db.prepare("SELECT name FROM agents WHERE id=?").get(legacyAgent.id)
        ?.name,
      "Legacy Scout",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM agent_navigation_memberships").get()
        ?.n,
      0,
    );
    // A second connection holding the write lock cannot block a current-version read.
    const writer = new DatabaseSync(join(directory, "roost.sqlite"));
    writer.exec("BEGIN IMMEDIATE");
    migrateAgentNavigation(db);
    writer.exec("ROLLBACK");
    writer.close();
    db.exec("INSERT INTO agent_navigation_versions VALUES(4); BEGIN IMMEDIATE");
    assert.throws(() => migrateAgentNavigation(db), /newer version/);
    db.exec("CREATE TABLE outer_transaction_survives(id TEXT); ROLLBACK");
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='outer_transaction_survives'",
        )
        .get(),
      undefined,
    );
    db.exec(
      "DELETE FROM agent_navigation_versions WHERE version=4; DROP TABLE note_reads",
    );
    await assert.rejects(
      run(readAgentNavigation(directory)),
      /Unsupported database shape \(partial Notes\)/,
    );
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("saved agent order upgrades v1 and supports atomic placement within and across sections", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-navigation-order-"));
  try {
    for (const name of ["A", "B", "C", "D"]) {
      await run(
        saveAgent(
          {
            id: randomUUID(),
            name,
            instructions: "Fixture",
            character: "moss",
            model: "fixture",
          },
          directory,
        ),
      );
    }
    const original = await run(listAgents(directory));
    const [a, b, c, d] = original.map((agent) => agent.id) as [
      string,
      string,
      string,
      string,
    ];
    const db = new DatabaseSync(join(directory, "roost.sqlite"));
    db.exec(
      "DELETE FROM agent_navigation_versions WHERE version>=2; DROP TABLE agent_navigation_layout; ALTER TABLE agents DROP COLUMN navigationPosition",
    );
    const read = () => run(readAgentNavigation(directory));
    const change = (data: NavigationChange) =>
      run(changeAgentNavigation(data, directory));
    assert.deepEqual((await read()).agentOrder, [a, b, c, d]);
    assert.equal(
      db.prepare("SELECT MAX(version) v FROM agent_navigation_versions").get()
        ?.v,
      3,
    );
    const section = randomUUID();
    await change({ action: "create", id: section, name: "Work" });
    await change({ action: "move", agentId: c, sectionId: section });
    await change({ action: "move", agentId: b, sectionId: section });
    await change({
      action: "move",
      agentId: a,
      sectionId: section,
      beforeAgentId: b,
    });
    const members = async (sectionId: string | null) => {
      const nav = await read();
      return nav.agentOrder.filter(
        (id) => (nav.memberships[id] ?? null) === sectionId,
      );
    };
    assert.deepEqual(await members(section), [c, a, b]);
    await change({
      action: "move",
      agentId: b,
      sectionId: section,
      beforeAgentId: c,
    });
    assert.deepEqual(await members(section), [b, c, a]);
    await change({
      action: "move",
      agentId: a,
      sectionId: null,
      beforeAgentId: d,
    });
    assert.deepEqual(await members(null), [a, d]);
    const before = await read();
    for (const beforeAgentId of [randomUUID(), d, b]) {
      await assert.rejects(
        change({
          action: "move",
          agentId: b,
          sectionId: section,
          beforeAgentId,
        }),
      );
      assert.deepEqual(
        await read(),
        before,
        "bad or stale placement leaves membership and order unchanged",
      );
    }
    await change({
      action: "move",
      agentId: a,
      sectionId: null,
      beforeAgentId: null,
    });
    assert.deepEqual(await members(null), [d, a]);
    assert.deepEqual(
      await run(listAgents(directory)),
      original,
      "creation order and agent records returned by the API stay unchanged",
    );
    const added = await run(
      saveAgent({ ...original[0]!, id: randomUUID(), name: "New" }, directory),
    );
    assert.deepEqual(await members(null), [d, a, added.id]);
    await change({ action: "delete", id: section });
    assert.equal(new Set((await read()).agentOrder).size, 5);
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("section ordering includes Ungrouped and survives create, delete and v2 upgrade", async () => {
  const directory = mkdtempSync(join(tmpdir(), "roost-section-order-"));
  try {
    const a = randomUUID(),
      b = randomUUID(),
      c = randomUUID();
    const change = (data: NavigationChange) =>
      run(changeAgentNavigation(data, directory));
    const read = () => run(readAgentNavigation(directory));
    await change({ action: "create", id: a, name: "A" });
    await change({ action: "create", id: b, name: "B" });
    const db = new DatabaseSync(join(directory, "roost.sqlite"));
    db.exec(
      "DROP TABLE agent_navigation_layout; DELETE FROM agent_navigation_versions WHERE version=3; UPDATE agent_navigation_sections SET position=position+4",
    );
    let expected = await read();
    assert.deepEqual(
      orderedSections(expected).map((section) => section.id),
      [a, b, ""],
    );
    for (const action of [
      { action: "place-section", id: null, targetId: a, edge: "before" },
      { action: "place-section", id: null, targetId: b, edge: "after" },
      { action: "place-section", id: a, targetId: null, edge: "after" },
      { action: "place-section", id: a, targetId: b, edge: "before" },
      { action: "reorder-section", id: null, direction: "up" },
      { action: "reorder-section", id: null, direction: "up" },
      { action: "reorder-section", id: null, direction: "up" },
      { action: "reorder-section", id: a, direction: "up" },
      { action: "create", id: c, name: "C" },
      { action: "delete", id: a },
      { action: "reorder-section", id: null, direction: "down" },
      { action: "reorder-section", id: b, direction: "down" },
      { action: "collapse", id: b, collapsed: true },
      { action: "delete", id: c },
    ] satisfies NavigationChange[]) {
      expected = applyNavigationChange(expected, action);
      await change(action);
      assert.deepEqual(await read(), expected, JSON.stringify(action));
    }
    const snapshot = await read();
    await assert.rejects(
      change({
        action: "place-section",
        id: b,
        targetId: randomUUID(),
        edge: "before",
      }),
    );
    await assert.rejects(
      change({ action: "reorder-section", id: randomUUID(), direction: "up" }),
    );
    assert.deepEqual(await read(), snapshot);
    db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
