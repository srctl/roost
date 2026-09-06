import type { DatabaseSync } from "node:sqlite";
import type { Message } from "../../features/chat/schema";
import { withAgentStore } from "../agents/store.server";

export function putMessage(
  db: DatabaseSync,
  agentId: string,
  message: Message,
) {
  db.prepare(
    "INSERT INTO timeline (id, agentId, message) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET message = excluded.message WHERE timeline.agentId = excluded.agentId",
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
