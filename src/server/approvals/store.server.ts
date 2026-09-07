import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Schema } from "effect";
import {
  type Approval,
  ApprovalRequest,
  ApprovalResponse,
} from "../../features/approvals/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { notifyAttention } from "../notifications/push.server";
import { putMessage } from "../runs/timeline.server";
import { writeTransaction } from "../transaction.server";

type Row = {
  id: string;
  agentId: string;
  runId: string;
  threadId: string;
  requestKey: string;
  request: string;
  status: Approval["status"];
  response: string | null;
};
export type ApprovalContext = {
  agentId: string;
  runId: string;
  threadId: string;
  requestKey: string;
};

function notice(db: DatabaseSync, row: Row) {
  const request = JSON.parse(row.request) as ApprovalRequest;
  const response = row.response
    ? (JSON.parse(row.response) as ApprovalResponse)
    : null;
  putMessage(db, row.agentId, {
    id: `approval:${row.id}`,
    role: "notice",
    noticeKind: "approval",
    referenceId: row.id,
    title: request.title,
    text:
      row.status === "pending"
        ? "Waiting for you"
        : row.status === "cancelled"
          ? "Request expired; the run ended"
          : response?.decision === "approve"
            ? "Approved once"
            : response?.decision === "decline"
              ? "Declined"
              : "Answered",
  });
}

export function expireApprovals(db: DatabaseSync) {
  const rows = db
    .prepare(
      "SELECT a.* FROM approvals a LEFT JOIN runs r ON r.id=a.runId WHERE a.status='pending' AND (r.id IS NULL OR r.status<>'running' OR r.cancelRequested=1)",
    )
    .all() as Row[];
  for (const row of rows) {
    db.prepare(
      "UPDATE approvals SET status='cancelled',resolvedAt=? WHERE id=? AND status='pending'",
    ).run(Date.now(), row.id);
    notice(db, { ...row, status: "cancelled" });
  }
}

function requireLiveRun(
  db: DatabaseSync,
  context: Omit<ApprovalContext, "requestKey">,
) {
  if (
    !db
      .prepare(
        "SELECT id FROM runs WHERE id=? AND agentId=? AND threadId=? AND status='running' AND cancelRequested=0",
      )
      .get(context.runId, context.agentId, context.threadId)
  )
    throw new AgentStoreError({ message: "This request is no longer active." });
}

export const createApproval = (
  context: ApprovalContext,
  input: ApprovalRequest,
) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      const request = Schema.decodeUnknownSync(ApprovalRequest)(input);
      if (
        request.questions &&
        new Set(request.questions.map((question) => question.id)).size !==
          request.questions.length
      )
        throw new AgentStoreError({
          message: "Each question needs its own identifier.",
        });
      requireLiveRun(db, context);
      const existing = db
        .prepare("SELECT * FROM approvals WHERE runId=? AND requestKey=?")
        .get(context.runId, context.requestKey) as Row | undefined;
      if (existing) {
        if (
          existing.agentId !== context.agentId ||
          existing.threadId !== context.threadId ||
          existing.request !== JSON.stringify(request)
        )
          throw new AgentStoreError({
            message:
              "The approval request changed. Ask the agent to try again.",
          });
        return existing.id;
      }
      const id = randomUUID();
      const row: Row = {
        ...context,
        id,
        request: JSON.stringify(request),
        status: "pending",
        response: null,
      };
      db.prepare(
        "INSERT INTO approvals (id,agentId,runId,threadId,requestKey,request,createdAt) VALUES (?,?,?,?,?,?,?)",
      ).run(
        id,
        context.agentId,
        context.runId,
        context.threadId,
        context.requestKey,
        row.request,
        Date.now(),
      );
      notice(db, row);
      return id;
    }),
  );

export const readApprovals = (agentId: string, id?: string) =>
  withAgentStore((db) => {
    expireApprovals(db);
    const rows = (
      id
        ? db
            .prepare("SELECT * FROM approvals WHERE agentId=? AND id=?")
            .all(agentId, id)
        : db
            .prepare(
              "SELECT * FROM approvals WHERE agentId=? AND status='pending' ORDER BY createdAt",
            )
            .all(agentId)
    ) as Row[];
    return rows.map((row): Approval => ({
      ...JSON.parse(row.request),
      id: row.id,
      status: row.status,
      response: row.response ? JSON.parse(row.response) : null,
    }));
  });

export const answerApproval = (
  agentId: string,
  id: string,
  input: ApprovalResponse,
) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      const row = db
        .prepare("SELECT * FROM approvals WHERE agentId=? AND id=?")
        .get(agentId, id) as Row | undefined;
      if (!row)
        throw new AgentStoreError({ message: "Approval request not found." });
      const response = Schema.decodeUnknownSync(ApprovalResponse)(input);
      if (
        row.status === "answered" &&
        row.response === JSON.stringify(response)
      )
        return;
      if (row.status !== "pending")
        throw new AgentStoreError({
          message: "This request was already resolved.",
        });
      requireLiveRun(db, row);
      const request = JSON.parse(row.request) as ApprovalRequest;
      if (request.questions?.length) {
        if (
          response.decision !== "answer" ||
          request.questions.some((q) => {
            const answer = response.answers?.[q.id];
            return (
              !answer?.trim() ||
              (!q.allowOther &&
                !q.options.some((option) => option.label === answer))
            );
          }) ||
          Object.keys(response.answers ?? {}).some(
            (key) => !request.questions!.some((q) => q.id === key),
          )
        )
          throw new AgentStoreError({
            message: "Choose an answer for every question.",
          });
      } else if (response.decision === "answer" || response.answers) {
        throw new AgentStoreError({
          message: "Approve or decline this action.",
        });
      }
      const updated: Row = {
        ...row,
        status: "answered",
        response: JSON.stringify(response),
      };
      db.prepare(
        "UPDATE approvals SET status='answered',response=?,resolvedAt=? WHERE id=? AND status='pending'",
      ).run(updated.response, Date.now(), id);
      notice(db, updated);
    }),
  );

export const cancelApproval = (context: ApprovalContext) =>
  withAgentStore((db) => {
    const row = db
      .prepare(
        "SELECT * FROM approvals WHERE agentId=? AND runId=? AND threadId=? AND requestKey=? AND status='pending'",
      )
      .get(
        context.agentId,
        context.runId,
        context.threadId,
        context.requestKey,
      ) as Row | undefined;
    if (!row) return;
    db.prepare(
      "UPDATE approvals SET status='cancelled',resolvedAt=? WHERE id=? AND status='pending'",
    ).run(Date.now(), row.id);
    notice(db, { ...row, status: "cancelled" });
  });

// The browser can detach while the server waits. Only a persisted, validated
// response resumes this exact request; stopping/restarting never grants approval.
export async function waitForApproval(
  context: ApprovalContext,
  request: ApprovalRequest,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const id = await Effect.runPromise(createApproval(context, request));
  notifyAttention({ agentId: context.agentId, id, kind: "approval" });
  try {
    while (true) {
      signal?.throwIfAborted();
      const row = await Effect.runPromise(
        withAgentStore((db) => {
          expireApprovals(db);
          requireLiveRun(db, context);
          return db
            .prepare("SELECT * FROM approvals WHERE id=?")
            .get(id) as Row;
        }),
      );
      signal?.throwIfAborted();
      if (row.status === "answered")
        return JSON.parse(row.response!) as ApprovalResponse;
      if (row.status !== "pending")
        throw new Error("The approval request expired.");
      await delay(300, undefined, { signal });
    }
  } finally {
    await Effect.runPromise(cancelApproval(context));
  }
}
