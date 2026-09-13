import { Schema } from "effect";
import {
  type AgentNavigation,
  NavigationChange,
  RenameAgentInput,
} from "../../features/agents/navigation-schema";
import { AgentStoreError, withAgentStore } from "./store.server";

export const renameAgent = (
  input: typeof RenameAgentInput.Type,
  directory?: string,
) =>
  withAgentStore((db) => {
    const data = Schema.decodeUnknownSync(RenameAgentInput)(input);
    const updated = db
      .prepare("UPDATE agents SET name=? WHERE id=?")
      .run(data.name, data.agentId);
    if (!updated.changes)
      throw new AgentStoreError({ message: "Agent not found." });
    return data;
  }, directory);

export const readAgentNavigation = (directory?: string) =>
  withAgentStore(
    (db): AgentNavigation => ({
      sections: db
        .prepare("SELECT * FROM agent_navigation_sections ORDER BY position,id")
        .all()
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          position: Number(row.position),
          collapsed: Boolean(row.collapsed),
        })),
      memberships: Object.fromEntries(
        db
          .prepare(
            "SELECT m.agentId,m.sectionId FROM agent_navigation_memberships m JOIN agents a ON a.id=m.agentId JOIN agent_navigation_sections s ON s.id=m.sectionId ORDER BY m.agentId",
          )
          .all()
          .map((row) => [String(row.agentId), String(row.sectionId)]),
      ),
    }),
    directory,
  );

export const changeAgentNavigation = (
  input: NavigationChange,
  directory?: string,
) =>
  withAgentStore((db) => {
    const data = Schema.decodeUnknownSync(NavigationChange)(input);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (data.action === "move") {
        if (!db.prepare("SELECT id FROM agents WHERE id=?").get(data.agentId))
          throw new AgentStoreError({ message: "Agent not found." });
        if (
          data.sectionId !== null &&
          !db
            .prepare("SELECT id FROM agent_navigation_sections WHERE id=?")
            .get(data.sectionId)
        )
          throw new AgentStoreError({ message: "Section not found." });
        if (data.sectionId === null)
          db.prepare(
            "DELETE FROM agent_navigation_memberships WHERE agentId=?",
          ).run(data.agentId);
        else
          db.prepare(
            "INSERT INTO agent_navigation_memberships VALUES (?,?) ON CONFLICT(agentId) DO UPDATE SET sectionId=excluded.sectionId",
          ).run(data.agentId, data.sectionId);
      } else if (data.action === "create") {
        const existing = db
          .prepare("SELECT name FROM agent_navigation_sections WHERE id=?")
          .get(data.id);
        if (existing && existing.name !== data.name)
          throw new AgentStoreError({
            message: "Section already exists. Reload and try again.",
          });
        if (!existing)
          db.prepare(
            "INSERT INTO agent_navigation_sections(id,name,position) SELECT ?,?,COALESCE(MAX(position),-1)+1 FROM agent_navigation_sections",
          ).run(data.id, data.name);
      } else {
        if (
          !db
            .prepare("SELECT id FROM agent_navigation_sections WHERE id=?")
            .get(data.id)
        )
          throw new AgentStoreError({ message: "Section not found." });
        if (data.action === "rename")
          db.prepare(
            "UPDATE agent_navigation_sections SET name=? WHERE id=?",
          ).run(data.name, data.id);
        if (data.action === "collapse")
          db.prepare(
            "UPDATE agent_navigation_sections SET collapsed=? WHERE id=?",
          ).run(Number(data.collapsed), data.id);
        if (data.action === "delete") {
          db.prepare(
            "DELETE FROM agent_navigation_memberships WHERE sectionId=?",
          ).run(data.id);
          db.prepare("DELETE FROM agent_navigation_sections WHERE id=?").run(
            data.id,
          );
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }, directory);
