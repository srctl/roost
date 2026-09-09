import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Automation } from "../../features/automations/schema";
import type { Message, SendMessage } from "../../features/chat/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { expireApprovals } from "../approvals/store.server";
import { nextOccurrence, scheduleWindow } from "../automations/schedule";
import { readAutomations, requireAgent } from "../automations/store.server";
import { deliverDelegationResults } from "../delegations/store.server";
import { linkAttachments, readRunFiles } from "../files/store.server";
import { assertAvailable, isMaintenance } from "../maintenance.server";
import { notifyRunFinished } from "../notifications/push.server";
import { scheduleReflections } from "../reflections/store.server";
import { writeTransaction } from "../transaction.server";
import { putMessage } from "./timeline.server";

export type Run = {
  id: string;
  agentId: string;
  kind:
    | "chat"
    | "automation"
    | "delegation"
    | "handoff"
    | "reflection"
    | "coding";
  prompt: string;
  status: string;
  automationId: string | null;
  scheduledFor: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  messages: string;
  error: string | null;
  threadId: string | null;
  soulRevision: string | null;
  owner: string | null;
  cancelRequested: number;
  automationSnapshot: string | null;
};

export type RunSummary = Pick<Run, "id" | "kind" | "status" | "createdAt"> & {
  automationName: string | null;
};

export function insertRun(
  db: DatabaseSync,
  run: {
    id: string;
    agentId: string;
    prompt: string;
    automation?: Automation;
    scheduledFor?: number;
  },
  now = Date.now(),
) {
  assertAvailable(db);
  db.prepare(
    "INSERT OR IGNORE INTO runs (id,agentId,kind,prompt,status,automationId,scheduledFor,createdAt,automationSnapshot) VALUES (?,?,?,?,'queued',?,?,?,?)",
  ).run(
    run.id,
    run.agentId,
    run.automation ? "automation" : "chat",
    run.prompt,
    run.automation?.id ?? null,
    run.scheduledFor ?? null,
    now,
    run.automation ? JSON.stringify(run.automation) : null,
  );
}

export const enqueueChat = (input: SendMessage) =>
  withAgentStore((db) => {
    requireAgent(db, input.agentId);
    if (!input.text.trim() && !input.attachmentIds?.length)
      throw new AgentStoreError({
        message: "Write a message or attach a file.",
      });
    const existing = db
      .prepare("SELECT * FROM runs WHERE id=?")
      .get(input.messageId) as Run | undefined;
    if (
      existing &&
      (existing.agentId !== input.agentId ||
        existing.prompt !== input.text ||
        existing.kind !== "chat")
    )
      throw new AgentStoreError({
        message: "This message ID has already been used.",
      });
    if (existing) {
      const files = readRunFiles(
        db,
        input.agentId,
        input.messageId,
        "attachment",
      );
      const ids = input.attachmentIds ?? [];
      if (
        files.length !== ids.length ||
        files.some((file) => !ids.includes(file.id))
      )
        throw new AgentStoreError({
          message: "This message has already been sent with different files.",
        });
    }
    return writeTransaction(db, () => {
      insertRun(db, {
        id: input.messageId,
        agentId: input.agentId,
        prompt: input.text,
      });
      const files = linkAttachments(
        db,
        input.agentId,
        input.messageId,
        input.attachmentIds,
      );
      putMessage(db, input.agentId, {
        id: input.messageId,
        role: "user",
        text: input.text,
        ...(files.length ? { files } : {}),
      });

      const active = db
        .prepare(
          "SELECT id FROM runs WHERE agentId=? AND status='running' AND kind IN ('chat','handoff') AND cancelRequested=0",
        )
        .get(input.agentId);
      return { id: active ? String(active.id) : input.messageId };
    });
  });

export const runAutomationNow = (
  agentId: string,
  id: string,
  requestId: string,
) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      const automation = readAutomations(db, agentId).find((a) => a.id === id);
      if (!automation)
        throw new AgentStoreError({ message: "Automation not found." });
      const existing = db
        .prepare("SELECT * FROM runs WHERE id=?")
        .get(requestId) as Run | undefined;
      if (
        existing &&
        (existing.agentId !== agentId || existing.automationId !== id)
      )
        throw new AgentStoreError({
          message: "This run ID has already been used.",
        });
      insertRun(db, {
        id: requestId,
        agentId,
        prompt: automation.prompt,
        automation,
      });

      return { id: requestId };
    }),
  );

export const listRuns = (agentId: string) =>
  withAgentStore(
    (db) =>
      db
        .prepare(
          "SELECT * FROM runs WHERE agentId=? ORDER BY createdAt DESC LIMIT 50",
        )
        .all(agentId) as Run[],
  );

export function readRunSummaries(
  db: DatabaseSync,
  agentId: string,
): RunSummary[] {
  return db
    .prepare(
      `SELECT id, kind, status, createdAt,
              json_extract(automationSnapshot, '$.name') AS automationName
       FROM runs WHERE agentId=? ORDER BY createdAt DESC LIMIT 50`,
    )
    .all(agentId) as RunSummary[];
}

export const cancelRun = (agentId: string, id: string) =>
  withAgentStore((db) => {
    // A follow-up belongs to the active run, including after a page reload.
    const steering = db
      .prepare(
        "SELECT owner FROM runs WHERE id=? AND agentId=? AND status='steering'",
      )
      .get(id, agentId);
    if (steering)
      db.prepare(
        "UPDATE runs SET cancelRequested=1 WHERE agentId=? AND owner=? AND status='running'",
      ).run(agentId, String(steering.owner));
    db.prepare(
      "UPDATE runs SET cancelRequested=1, status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END, finishedAt=CASE WHEN status='queued' THEN ? ELSE finishedAt END WHERE id=? AND agentId=? AND status IN ('queued','running')",
    ).run(Date.now(), id, agentId);
  });

export const schedulerTick = (owner: string, now = Date.now()) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      const lease = db
        .prepare("SELECT owner,heartbeat FROM worker_lease WHERE id=1")
        .get();
      if (
        lease &&
        lease.owner !== owner &&
        Number(lease.heartbeat) > now - 30000
      )
        return false;
      if (lease?.owner !== owner) {
        const abandoned = db
          .prepare("SELECT * FROM runs WHERE status IN ('running','steering')")
          .all() as Run[];
        for (const run of abandoned) {
          const messages = (JSON.parse(run.messages) as Message[]).map(
            (message) =>
              message.status === "inProgress"
                ? ({ ...message, status: "interrupted" } as Message)
                : message,
          );
          if (run.kind !== "automation" && run.kind !== "reflection")
            for (const message of messages)
              putMessage(db, run.agentId, message);
          db.prepare(
            "UPDATE runs SET status='interrupted',messages=?,finishedAt=?,error=? WHERE id=?",
          ).run(
            JSON.stringify(messages),
            now,
            "Roost restarted during this run. It was not retried automatically.",
            run.id,
          );
          putMessage(db, run.agentId, {
            id: `run:${run.id}`,
            role: "notice",
            noticeKind: "run",
            referenceId: run.id,
            title: "Run interrupted",
            text: "Roost restarted during this run. Check its history before running it again.",
          });
          queueMicrotask(() => notifyRunFinished(run.id));
        }
      }
      db.prepare(
        "INSERT INTO worker_lease (id,owner,heartbeat) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,heartbeat=excluded.heartbeat",
      ).run(owner, now);
      expireApprovals(db);
      if (isMaintenance(db)) return true;
      deliverDelegationResults(db, now);
      for (const automation of readAutomations(db)) {
        const { start, end } = scheduleWindow(automation.schedule);
        if (now > end) {
          db.prepare(
            "UPDATE automations SET enabled=0,nextRunAt=NULL WHERE id=? AND (enabled<>0 OR nextRunAt IS NOT NULL)",
          ).run(automation.id);
          db.prepare(
            "UPDATE runs SET status='cancelled',finishedAt=? WHERE automationId=? AND status='queued' AND scheduledFor IS NOT NULL",
          ).run(now, automation.id);
          continue;
        }
        if (
          now < start ||
          !automation.enabled ||
          automation.nextRunAt === null ||
          automation.nextRunAt > now
        )
          continue;
        // Coalesce downtime into one catch-up, then schedule the next future occurrence.
        if (
          !db
            .prepare(
              "SELECT id FROM runs WHERE automationId=? AND status='queued'",
            )
            .get(automation.id)
        )
          insertRun(
            db,
            {
              id: randomUUID(),
              agentId: automation.agentId,
              prompt: automation.prompt,
              automation,
              scheduledFor: automation.nextRunAt,
            },
            now,
          );
        const next = nextOccurrence(automation.schedule, now);
        db.prepare(
          "UPDATE automations SET nextRunAt=?,enabled=? WHERE id=?",
        ).run(next, Number(next !== null), automation.id);
      }

      scheduleReflections(db, now);
      return true;
    }),
  );

export const claimRun = (owner: string, allowBackground = true) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      const now = Date.now();

      const claimed = db
        .prepare(
          "UPDATE runs SET status='running',owner=?,startedAt=? WHERE id=(SELECT q.id FROM runs q WHERE q.status='queued' AND (? OR q.kind='chat') AND (SELECT maintenance FROM runtime_control WHERE id=1)=0 AND EXISTS (SELECT 1 FROM worker_lease WHERE owner=? AND heartbeat>?) AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.agentId=q.agentId AND r.status='running') ORDER BY CASE q.kind WHEN 'chat' THEN 0 WHEN 'reflection' THEN 2 ELSE 1 END,q.createdAt LIMIT 1) RETURNING *",
        )
        .get(owner, now, Number(allowBackground), owner, now - 30000) as
        | Run
        | undefined;
      if (claimed?.kind === "reflection")
        db.prepare(
          "UPDATE agent_reflections SET lastActivityAt=COALESCE((SELECT MAX(finishedAt) FROM runs WHERE agentId=? AND kind<>'reflection'),0) WHERE agentId=?",
        ).run(claimed.agentId, claimed.agentId);
      return claimed;
    }),
  );

// Only the worker holding this agent's active conversation may consume input.
// Mark it before sending: an ambiguous provider failure must never replay it.
export const claimSteeringRun = (run: Run) =>
  withAgentStore(
    (db) =>
      db
        .prepare(
          "UPDATE runs SET status='steering',owner=?,startedAt=?,threadId=(SELECT threadId FROM runs WHERE id=?) WHERE id=(SELECT q.id FROM runs q WHERE q.agentId=? AND q.kind='chat' AND q.status='queued' AND (SELECT maintenance FROM runtime_control WHERE id=1)=0 AND q.cancelRequested=0 AND EXISTS (SELECT 1 FROM runs r WHERE r.id=? AND r.owner=? AND r.status='running' AND r.kind IN ('chat','handoff') AND r.cancelRequested=0) AND EXISTS (SELECT 1 FROM worker_lease WHERE owner=? AND heartbeat>?) ORDER BY q.createdAt,q.rowid LIMIT 1) RETURNING *",
        )
        .get(
          run.owner,
          Date.now(),
          run.id,
          run.agentId,
          run.id,
          run.owner,
          run.owner,
          Date.now() - 30000,
        ) as Run | undefined,
  );

export const persistRun = (run: Run, messages: readonly Message[]) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      if (
        !db
          .prepare(
            "SELECT id FROM runs WHERE id=? AND status='running' AND owner=?",
          )
          .get(run.id, run.owner)
      )
        return;
      db.prepare("UPDATE runs SET messages=? WHERE id=?").run(
        JSON.stringify(messages),
        run.id,
      );
      if (run.kind !== "automation" && run.kind !== "reflection")
        for (const message of messages) putMessage(db, run.agentId, message);
    }),
  );

export const finishRun = (
  run: Run,
  status: string,
  messages: readonly Message[],
  error?: string,
) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      const current = db
        .prepare(
          "SELECT cancelRequested FROM runs WHERE id=? AND status='running' AND owner=?",
        )
        .get(run.id, run.owner);
      if (!current) return;
      if (current.cancelRequested) {
        status = "cancelled";
        error = "Stopped. This run will not retry automatically.";
      }
      const answer = [...messages]
        .reverse()
        .find((message) => message.role === "assistant")
        ?.text?.trim();
      if (
        status === "completed" &&
        (run.kind === "automation" ||
          run.kind === "delegation" ||
          run.kind === "reflection") &&
        !answer
      ) {
        status = "failed";
        error =
          "The task finished without a final response. Check its output before retrying.";
      }
      db.prepare(
        "UPDATE runs SET status=?,messages=?,error=?,finishedAt=? WHERE id=?",
      ).run(
        status,
        JSON.stringify(messages),
        error ?? null,
        Date.now(),
        run.id,
      );
      // Follow-ups share the parent's outcome and are never run again later.
      db.prepare(
        "UPDATE runs SET status=?,messages=?,error=?,finishedAt=?,threadId=(SELECT threadId FROM runs WHERE id=?) WHERE agentId=? AND owner=? AND status='steering'",
      ).run(
        status,
        JSON.stringify(messages),
        error ?? null,
        Date.now(),
        run.id,
        run.agentId,
        run.owner,
      );
      expireApprovals(db);
      if (run.kind !== "automation" && run.kind !== "reflection")
        for (const message of messages) putMessage(db, run.agentId, message);
      if (
        status === "completed" &&
        run.kind === "reflection" &&
        answer &&
        answer !== "ROOST_NO_UPDATE"
      ) {
        putMessage(db, run.agentId, {
          id: `result:${run.id}`,
          role: "assistant",
          title: "Reflection",
          text: answer,
        });
      }
      if (status === "completed" && run.kind === "automation") {
        const automation = JSON.parse(run.automationSnapshot!) as Automation;
        if (
          answer &&
          !(
            automation.notification === "when-needed" &&
            answer === "ROOST_NO_UPDATE"
          )
        )
          putMessage(db, run.agentId, {
            id: `result:${run.id}`,
            role: "assistant",
            title: automation.name,
            text: answer,
          });
      }
      if (status !== "completed")
        putMessage(db, run.agentId, {
          id: `run:${run.id}`,
          role: "notice",
          noticeKind: "run",
          referenceId: run.id,
          title:
            status === "cancelled"
              ? "Run stopped"
              : status === "failed"
                ? "Run failed"
                : "Run interrupted",
          text:
            error ??
            "This run was stopped. Its partial output is available in run history.",
        });
    }),
  );
