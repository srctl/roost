import { Schema } from "effect";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";
import { AgentStoreError, withAgentStore } from "./store.server";

export const DeleteAgentInput = Schema.Struct({
  agentId: Schema.UUID,
  name: Schema.String,
});

// No filesystem or external-worker operations belong in this transaction.
export const deleteAgentRecords = (
  input: typeof DeleteAgentInput.Type,
  directory?: string,
) =>
  withAgentStore(
    (db) =>
      writeTransaction(db, () => {
        const { agentId, name } =
          Schema.decodeUnknownSync(DeleteAgentInput)(input);
        assertAvailable(db);
        if (db.prepare("SELECT id FROM deleted_agents WHERE id=?").get(agentId))
          return;
        const agent = db
          .prepare("SELECT name FROM agents WHERE id=?")
          .get(agentId);
        if (!agent) throw new AgentStoreError({ message: "Agent not found." });
        if (agent.name !== name)
          throw new AgentStoreError({
            message: "This agent changed. Reload its settings before deleting.",
          });
        if (
          db
            .prepare(
              "SELECT id FROM runs WHERE agentId=? AND status IN ('running','steering') LIMIT 1",
            )
            .get(agentId)
        )
          throw new AgentStoreError({
            message:
              "This agent has an active turn. Stop it and wait for it to finish, then retry deletion.",
          });
        if (
          db
            .prepare(`SELECT id FROM coding_jobs WHERE agentId=? AND NOT (
    status IN ('completed','cancelled') OR
    (status IN ('queued','blocked') AND dispatchedAt IS NULL AND observedWorking=0
      AND sessionIdentity='' AND nativeSessionId='' AND paneId=''
      AND (status='queued' OR lastWorkerState='not_started'))
  ) LIMIT 1`)
            .get(agentId)
        )
          throw new AgentStoreError({
            message:
              "A coding worker may still be active. Inspect its job and confirm it is stopped or completed, then retry deletion.",
          });
        if (
          db
            .prepare(`SELECT d.id FROM delegations d JOIN runs r ON r.id=d.id
    WHERE (d.sourceAgentId=? OR d.targetAgentId=?) AND r.agentId<>?
    AND r.status IN ('queued','running','steering') LIMIT 1`)
            .get(agentId, agentId, agentId)
        )
          throw new AgentStoreError({
            message:
              "Another agent is still working on a delegated task for this agent. Let it finish or stop that task before deleting.",
          });
        db.prepare(
          "DELETE FROM delegations WHERE sourceAgentId=? OR targetAgentId=?",
        ).run(agentId, agentId);
        for (const table of [
          "conversations",
          "agent_sessions",
          "timeline",
          "timeline_imports",
          "soul_changes",
          "automations",
          "runs",
          "files",
          "approvals",
          "dashboards",
          "dashboard_datasets",
          "agent_notifications",
          "agent_reflections",
          "coding_settings",
          "coding_jobs",
          "coding_job_inputs",
          "coding_job_updates",
        ])
          db.prepare(`DELETE FROM ${table} WHERE agentId=?`).run(agentId);
        db.prepare("DELETE FROM agents WHERE id=?").run(agentId);
        db.prepare("INSERT INTO deleted_agents(id,deletedAt) VALUES (?,?)").run(
          agentId,
          Date.now(),
        );
      }),
    directory,
  );
