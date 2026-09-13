import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import {
  type AgentNavigation,
  NavigationChange,
  RenameAgentInput,
} from "../../features/agents/navigation-schema";
import {
  moveSection,
  placeAgent,
  placeSection,
} from "../../features/agents/navigation-state";
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

function readNavigation(db: DatabaseSync): AgentNavigation {
  return {
    ungroupedPosition: Number(
      db
        .prepare(
          "SELECT ungroupedPosition FROM agent_navigation_layout WHERE id=1",
        )
        .get()!.ungroupedPosition,
    ),
    agentOrder: db
      .prepare(
        "SELECT id FROM agents ORDER BY navigationPosition IS NULL, navigationPosition, createdAt, id",
      )
      .all()
      .map((row) => String(row.id)),
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
  };
}

export const readAgentNavigation = (directory?: string) =>
  withAgentStore(readNavigation, directory);

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
        if (data.beforeAgentId != null) {
          const target = db
            .prepare(
              "SELECT a.id, m.sectionId FROM agents a LEFT JOIN agent_navigation_memberships m ON m.agentId=a.id WHERE a.id=?",
            )
            .get(data.beforeAgentId);
          if (
            !target ||
            target.id === data.agentId ||
            (target.sectionId ?? null) !== data.sectionId
          )
            throw new AgentStoreError({
              message: "The destination changed. Try moving the agent again.",
            });
        }
        if (data.sectionId === null)
          db.prepare(
            "DELETE FROM agent_navigation_memberships WHERE agentId=?",
          ).run(data.agentId);
        else
          db.prepare(
            "INSERT INTO agent_navigation_memberships VALUES (?,?) ON CONFLICT(agentId) DO UPDATE SET sectionId=excluded.sectionId",
          ).run(data.agentId, data.sectionId);
        const order = db
          .prepare(
            "SELECT id FROM agents ORDER BY navigationPosition IS NULL, navigationPosition, createdAt, id",
          )
          .all()
          .map((row) => String(row.id));
        const memberships = Object.fromEntries(
          db
            .prepare(
              "SELECT agentId, sectionId FROM agent_navigation_memberships",
            )
            .all()
            .map((row) => [String(row.agentId), String(row.sectionId)]),
        );
        const next = placeAgent(
          order,
          memberships,
          data.agentId,
          data.sectionId,
          data.beforeAgentId ?? null,
        );
        const position = db.prepare(
          "UPDATE agents SET navigationPosition=? WHERE id=?",
        );
        next.forEach((id, index) => {
          position.run(index, id);
        });
      } else if (
        data.action === "reorder-section" ||
        data.action === "place-section"
      ) {
        const navigation = readNavigation(db);
        if (
          data.id !== null &&
          !navigation.sections.some((section) => section.id === data.id)
        )
          throw new AgentStoreError({ message: "Section not found." });
        if (
          data.action === "place-section" &&
          data.targetId !== null &&
          !navigation.sections.some((section) => section.id === data.targetId)
        )
          throw new AgentStoreError({
            message: "Destination section not found.",
          });
        const next =
          data.action === "place-section"
            ? placeSection(navigation, data.id, data.targetId, data.edge)
            : moveSection(navigation, data.id, data.direction);
        const update = db.prepare(
          "UPDATE agent_navigation_sections SET position=? WHERE id=?",
        );
        next.sections.forEach((section) => {
          update.run(section.position, section.id);
        });
        db.prepare(
          "UPDATE agent_navigation_layout SET ungroupedPosition=? WHERE id=1",
        ).run(next.ungroupedPosition);
      } else if (data.action === "create") {
        const existing = db
          .prepare("SELECT name FROM agent_navigation_sections WHERE id=?")
          .get(data.id);
        if (existing && existing.name !== data.name)
          throw new AgentStoreError({
            message: "Section already exists. Reload and try again.",
          });
        if (!existing) {
          const count = Number(
            db
              .prepare("SELECT COUNT(*) n FROM agent_navigation_sections")
              .get()!.n,
          );
          db.prepare(
            "UPDATE agent_navigation_layout SET ungroupedPosition=ungroupedPosition+1 WHERE id=1 AND ungroupedPosition=?",
          ).run(count);
          db.prepare(
            "INSERT INTO agent_navigation_sections(id,name,position) SELECT ?,?,COALESCE(MAX(position),-1)+1 FROM agent_navigation_sections",
          ).run(data.id, data.name);
        }
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
          const position = Number(
            db
              .prepare(
                "SELECT position FROM agent_navigation_sections WHERE id=?",
              )
              .get(data.id)!.position,
          );
          db.prepare(
            "UPDATE agent_navigation_sections SET position=position-1 WHERE position>?",
          ).run(position);
          db.prepare(
            "UPDATE agent_navigation_layout SET ungroupedPosition=ungroupedPosition-1 WHERE ungroupedPosition>?",
          ).run(position);
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
