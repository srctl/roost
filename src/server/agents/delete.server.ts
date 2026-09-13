import { Schema } from "effect";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";
import { agentOwnedTables } from "./deletion-migration.server";
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
        // A terminal job label does not prove that its direct queue is settled.
        // Include uncertain receipts/fences so an in-flight external prompt can
        // never lose its ownership records while dispatch runs outside SQLite.
        if (
          db
            .prepare(`SELECT id FROM coding_job_inputs WHERE agentId=? AND status IN ('queued','dispatching')
          UNION ALL SELECT m.inputId FROM coding_worker_messages m LEFT JOIN coding_job_inputs i ON i.id=m.inputId WHERE m.agentId=? AND (i.status='failed' OR (m.completedAt IS NULL AND (m.deliveredAt IS NOT NULL OR m.respondingAt IS NOT NULL) AND (i.status IS NULL OR i.status!='abandoned')))
          UNION ALL SELECT inputId FROM coding_worker_fences WHERE agentId=? AND acknowledgedAt IS NULL LIMIT 1`)
            .get(agentId, agentId, agentId)
        )
          throw new AgentStoreError({
            message:
              "A coding worker has queued or unsettled work. Inspect and settle its queue before deleting this agent.",
          });
        db.prepare(
          "DELETE FROM delegations WHERE sourceAgentId=? OR targetAgentId=?",
        ).run(agentId, agentId);
        for (const table of agentOwnedTables)
          db.prepare(`DELETE FROM ${table} WHERE agentId=?`).run(agentId);
        db.prepare("DELETE FROM agents WHERE id=?").run(agentId);
        db.prepare("INSERT INTO deleted_agents(id,deletedAt) VALUES (?,?)").run(
          agentId,
          Date.now(),
        );
      }),
    directory,
  );
