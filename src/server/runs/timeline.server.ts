import type { DatabaseSync } from "node:sqlite";
import type { Message } from "../../features/chat/schema";
import { withAgentStore } from "../agents/store.server";

export function putMessage(
  db: DatabaseSync,
  agentId: string,
  message: Message,
) {
  db.prepare(
    "INSERT INTO timeline (id, agentId, message) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET message = excluded.message WHERE timeline.agentId = excluded.agentId AND timeline.message != excluded.message",
  ).run(message.id, agentId, JSON.stringify(message));
}
export const readTimeline = (agentId: string) =>
  withAgentStore((db) =>
    db
      .prepare(
        "SELECT message FROM timeline WHERE agentId = ? ORDER BY position",
      )
      .all(agentId)
      .map((row) => JSON.parse(String(row.message)) as Message),
  );

export type TimelineEntry = { position: number; message: Message };
export type TimelinePage = {
  entries: TimelineEntry[];
  revision: number;
  before: number | null;
};

// Bound tool output on the wire as well as the number of rendered messages.
// The original message remains in SQLite and is available on explicit request.
const preview = `CASE WHEN json_extract(message,'$.role')='activity' THEN
  json_set(message, '$.text', substr(json_extract(message,'$.text'),1,2000),
    '$.details', substr(COALESCE(json_extract(message,'$.details'),''),1,2000),
    '$.truncated', json(CASE WHEN length(json_extract(message,'$.text'))>2000 OR length(json_extract(message,'$.details'))>2000 THEN 'true' ELSE 'false' END))
  ELSE message END`;

export function readTimelinePage(
  db: DatabaseSync,
  agentId: string,
  options: { since?: number; before?: number } = {},
): TimelinePage {
  // One read transaction keeps the cursor and rows consistent with worker writes.
  db.exec("BEGIN");
  try {
    const revision = Number(
      db.prepare("SELECT value FROM timeline_revision WHERE id=1").get()!.value,
    );
    const incremental = options.since !== undefined;
    const rows = incremental
      ? db
          .prepare(
            `SELECT position, revision, ${preview} AS message FROM timeline WHERE agentId=? AND revision>? ORDER BY revision LIMIT 61`,
          )
          .all(agentId, options.since!)
      : db
          .prepare(
            `SELECT position, revision, ${preview} AS message FROM timeline WHERE agentId=? AND position<? ORDER BY position DESC LIMIT 61`,
          )
          .all(agentId, options.before ?? Number.MAX_SAFE_INTEGER);
    // If updates exceed a page, return a cursor through only the delivered rows.
    const selected = rows.slice(0, 60);
    const cursor =
      incremental && rows.length > 60
        ? Number(selected.at(-1)!.revision)
        : revision;
    const entries = selected
      .map((row) => ({
        position: Number(row.position),
        message: JSON.parse(String(row.message)) as Message,
      }))
      .sort((a, b) => a.position - b.position);
    db.exec("COMMIT");
    return {
      entries,
      revision: cursor,
      before: !incremental && rows.length > 60 ? entries[0]!.position : null,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
