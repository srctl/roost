import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Effect, Schema } from "effect";
import {
  NoteContent,
  NoteInstructionWrite,
  NotePatch,
  NoteRestore,
  type NoteSnapshot,
  NoteWrite,
} from "../../features/notes/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";

function fail(message: string): never {
  throw new AgentStoreError({ message });
}

function current(db: DatabaseSync, agentId: string): NoteSnapshot {
  assertAvailable(db);
  requireAgent(db, agentId);
  const row = db
    .prepare("SELECT * FROM agent_notes WHERE agentId=?")
    .get(agentId);
  return row
    ? {
        agentId,
        revision: Number(row.revision),
        blocks: Schema.decodeUnknownSync(NoteContent)(
          JSON.parse(String(row.blocks)),
        ),
        instructions: String(row.instructions),
        updatedAt: Number(row.updatedAt),
      }
    : { agentId, revision: 0, blocks: [], instructions: "", updatedAt: 0 };
}

export const readNote = (agentId: string, scope?: string) =>
  withAgentStore((db) => {
    const note = current(db, agentId);
    if (!scope) return { ...note, readToken: undefined };
    const readToken = randomUUID();
    db.prepare("DELETE FROM note_reads WHERE expiresAt < ?").run(Date.now());
    db.prepare("INSERT INTO note_reads VALUES (?,?,?,?,?)").run(
      readToken,
      agentId,
      scope,
      note.revision,
      Date.now() + 60 * 60_000,
    );
    return { ...note, readToken };
  });

function validate<A, I>(schema: Schema.Schema<A, I>, input: unknown): A {
  try {
    return Schema.decodeUnknownSync(schema)(input);
  } catch {
    return fail(
      "Invalid note content or request. Notes allow up to 500 blocks and 200,000 characters; instructions allow 8,000 characters.",
    );
  }
}

function mutate(
  agentId: string,
  input: { requestId: string; revision: number },
  kind: string,
  change: (db: DatabaseSync, note: NoteSnapshot) => NoteSnapshot,
  source = "user",
) {
  return withAgentStore((db) =>
    writeTransaction(db, () => {
      const note = current(db, agentId);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ kind, input, source }))
        .digest("hex");
      const retry = db
        .prepare("SELECT * FROM note_requests WHERE agentId=? AND requestId=?")
        .get(agentId, input.requestId);
      if (retry) {
        if (retry.fingerprint !== fingerprint)
          fail("This request ID was already used for a different note edit.");
        return JSON.parse(String(retry.snapshot)) as NoteSnapshot;
      }
      if (input.revision !== note.revision)
        fail(
          "NOTE_CONFLICT: This note or its instructions changed. Read the current note and reconcile before retrying.",
        );
      const next = change(db, note);
      validate(NoteContent, next.blocks);
      if (
        JSON.stringify(next.blocks) === JSON.stringify(note.blocks) &&
        next.instructions === note.instructions
      ) {
        db.prepare("INSERT INTO note_requests VALUES (?,?,?,?)").run(
          agentId,
          input.requestId,
          fingerprint,
          JSON.stringify(note),
        );
        return note;
      }
      next.revision = note.revision + 1;
      next.updatedAt = Date.now();
      db.prepare("INSERT OR IGNORE INTO note_revisions VALUES (?,?,?,?)").run(
        agentId,
        note.revision,
        JSON.stringify(note),
        "initial",
      );
      db.prepare(
        "INSERT INTO agent_notes VALUES (?,?,?,?,?) ON CONFLICT(agentId) DO UPDATE SET revision=excluded.revision,blocks=excluded.blocks,instructions=excluded.instructions,updatedAt=excluded.updatedAt",
      ).run(
        agentId,
        next.revision,
        JSON.stringify(next.blocks),
        next.instructions,
        next.updatedAt,
      );
      db.prepare("INSERT INTO note_revisions VALUES (?,?,?,?)").run(
        agentId,
        next.revision,
        JSON.stringify(next),
        source,
      );
      db.prepare("INSERT INTO note_requests VALUES (?,?,?,?)").run(
        agentId,
        input.requestId,
        fingerprint,
        JSON.stringify(next),
      );
      return next;
    }),
  );
}

export const saveNote = (agentId: string, input: typeof NoteWrite.Type) => {
  // Validation inside the Effect keeps API failures serializable.
  return withAgentStore(() => validate(NoteWrite, input)).pipe(
    // Store operations stay synchronous inside their own write transaction.
    Effect.flatMap((data) =>
      mutate(agentId, data, "content", (_db, note) => ({
        ...note,
        blocks: data.blocks,
      })),
    ),
  );
};

export const saveNoteInstructions = (
  agentId: string,
  input: typeof NoteInstructionWrite.Type,
) =>
  withAgentStore(() => validate(NoteInstructionWrite, input)).pipe(
    Effect.flatMap((data) =>
      mutate(agentId, data, "instructions", (_db, note) => ({
        ...note,
        instructions: data.instructions,
      })),
    ),
  );

function requireRead(
  db: DatabaseSync,
  agentId: string,
  scope: string,
  token: string,
  revision: number,
) {
  const read = db
    .prepare(
      "SELECT * FROM note_reads WHERE token=? AND agentId=? AND scope=? AND revision=? AND expiresAt>=?",
    )
    .get(token, agentId, scope, revision, Date.now());
  if (!read)
    fail(
      "Read the current note and maintenance instructions in this run before editing.",
    );
}

export const patchNote = (
  agentId: string,
  scope: string,
  input: typeof NotePatch.Type,
) =>
  withAgentStore(() => validate(NotePatch, input)).pipe(
    Effect.flatMap((data) =>
      mutate(
        agentId,
        data,
        "patch",
        (db, note) => {
          requireRead(db, agentId, scope, data.readToken, note.revision);
          const blocks = [...note.blocks];
          const ids = new Set<string>();
          for (const edit of data.edits) {
            if (ids.has(edit.id)) fail("Target each block only once per edit.");
            ids.add(edit.id);
            const index = blocks.findIndex((b) => b.id === edit.id);
            if (
              JSON.stringify(index < 0 ? null : blocks[index]) !==
              JSON.stringify(edit.before)
            )
              fail(
                "NOTE_CONFLICT: A target block does not match. Read and reconcile before retrying.",
              );
            if (edit.after && edit.after.id !== edit.id)
              fail("An edit must preserve its block ID.");
            if (index >= 0) {
              if (edit.after) blocks[index] = edit.after;
              else blocks.splice(index, 1);
            } else {
              if (!edit.after || edit.afterId === undefined)
                fail(
                  "New blocks require content and an explicit afterId (null for the beginning).",
                );
              const anchor =
                edit.afterId === null
                  ? -1
                  : blocks.findIndex((b) => b.id === edit.afterId);
              if (edit.afterId !== null && anchor < 0)
                fail("Insertion anchor not found. Read the note again.");
              blocks.splice(anchor + 1, 0, edit.after);
            }
          }
          return { ...note, blocks };
        },
        `agent:${scope}`,
      ),
    ),
  );

export const noteHistory = (
  agentId: string,
  before = Number.MAX_SAFE_INTEGER,
) =>
  withAgentStore((db) => {
    current(db, agentId);
    return db
      .prepare(
        "SELECT revision,source,json_extract(snapshot,'$.updatedAt') AS updatedAt FROM note_revisions WHERE agentId=? AND revision < ? ORDER BY revision DESC LIMIT 100",
      )
      .all(agentId, before) as unknown as {
      revision: number;
      source: string;
      updatedAt: number;
    }[];
  });

export const restoreNote = (
  agentId: string,
  input: typeof NoteRestore.Type,
  agentRead?: { scope: string; readToken: string },
) =>
  withAgentStore(() => validate(NoteRestore, input)).pipe(
    Effect.flatMap((data) =>
      mutate(
        agentId,
        data,
        "restore",
        (db, note) => {
          if (agentRead)
            requireRead(
              db,
              agentId,
              agentRead.scope,
              agentRead.readToken,
              note.revision,
            );
          const row = db
            .prepare(
              "SELECT snapshot FROM note_revisions WHERE agentId=? AND revision=?",
            )
            .get(agentId, data.targetRevision);
          if (!row) fail("Note revision not found for this agent.");
          // Restore content only: instructions are user-owned and cannot be restored by an agent.
          return {
            ...note,
            blocks: validate(
              NoteContent,
              JSON.parse(String(row.snapshot)).blocks,
            ),
          };
        },
        agentRead ? `agent:${agentRead.scope}` : "user",
      ),
    ),
  );

export const readNoteRevision = (agentId: string, revision: number) =>
  withAgentStore((db) => {
    current(db, agentId);
    const row = db
      .prepare(
        "SELECT snapshot FROM note_revisions WHERE agentId=? AND revision=?",
      )
      .get(agentId, revision);
    if (!row) fail("Note revision not found for this agent.");
    return JSON.parse(String(row.snapshot)) as NoteSnapshot;
  });
