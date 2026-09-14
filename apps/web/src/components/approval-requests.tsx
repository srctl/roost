import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import {
  getApprovals,
  respondToApproval,
} from "../features/approvals/functions";
import type { Approval, ApprovalResponse } from "../features/approvals/schema";
import { motion } from "../styles/motion.stylex";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

export function ApprovalRequests({
  agentId,
  id,
  busy = true,
  runId,
}: {
  agentId: string;
  id?: string;
  busy?: boolean;
  runId?: string;
}) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!busy && !id) {
      setApprovals([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await getApprovals({ data: { agentId, id } });
        if (cancelled) return;
        if (result.ok) {
          setApprovals(
            runId
              ? result.value.filter((a) => a.runId === runId)
              : result.value,
          );
          setError(undefined);
        } else setError(result.error);
      } catch {
        if (!cancelled) setError("Could not load approval requests.");
      }
      if (!cancelled && busy) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [agentId, id, busy, runId]);
  return (
    <div aria-live="polite" {...stylex.props(styles.list)}>
      {error && <p role="alert">{error}</p>}
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          agentId={agentId}
          approval={approval}
          onResolved={(response) =>
            setApprovals((current) =>
              id
                ? current.map((item) =>
                    item.id === approval.id
                      ? { ...item, status: "answered", response }
                      : item,
                  )
                : current.filter((item) => item.id !== approval.id),
            )
          }
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  agentId,
  approval,
  onResolved,
}: {
  agentId: string;
  approval: Approval;
  onResolved: (response: ApprovalResponse) => void;
}) {
  const [sending, setSending] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  async function respond(response: ApprovalResponse) {
    setSending(true);
    setError(undefined);
    try {
      const result = await respondToApproval({
        data: { agentId, id: approval.id, response },
      });
      if (result.ok) onResolved(response);
      else setError(result.error);
    } catch {
      setError("Could not send your decision. Try again.");
    } finally {
      setSending(false);
    }
  }
  return (
    <section aria-label={approval.title} {...stylex.props(styles.card)}>
      <strong>{approval.title}</strong>
      <pre {...stylex.props(styles.details)}>{approval.details}</pre>
      {approval.status === "pending" ? (
        <>
          {approval.questions?.map((question) => (
            <fieldset
              key={question.id}
              disabled={sending}
              {...stylex.props(styles.question)}
            >
              <legend>{question.question}</legend>
              {question.options.map((option) => (
                <label key={option.label} {...stylex.props(styles.option)}>
                  <input
                    type="radio"
                    name={`${approval.id}:${question.id}`}
                    checked={answers[question.id] === option.label}
                    onChange={() =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: option.label,
                      }))
                    }
                  />
                  <span>
                    {option.label}
                    {option.description && (
                      <small {...stylex.props(styles.description)}>
                        {option.description}
                      </small>
                    )}
                  </span>
                </label>
              ))}
              {question.allowOther && (
                <input
                  aria-label={`Your answer: ${question.question}`}
                  placeholder="Your answer"
                  maxLength={32000}
                  value={answers[question.id] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  {...stylex.props(styles.input)}
                />
              )}
            </fieldset>
          ))}
          <div {...stylex.props(styles.actions)}>
            {approval.questions?.length ? (
              <Button
                disabled={
                  sending ||
                  approval.questions.some((q) => !answers[q.id]?.trim())
                }
                onClick={() => void respond({ decision: "answer", answers })}
                xstyle={styles.approve}
              >
                Send answer
              </Button>
            ) : (
              <>
                <Button
                  disabled={sending}
                  onClick={() => void respond({ decision: "approve" })}
                  xstyle={styles.approve}
                >
                  Approve once
                </Button>
                <Button
                  disabled={sending}
                  onClick={() => void respond({ decision: "decline" })}
                >
                  Decline
                </Button>
              </>
            )}
            {sending && <span role="status">Sending…</span>}
          </div>
        </>
      ) : (
        <p>
          {approval.status === "cancelled"
            ? "This request expired when the run ended."
            : approval.response?.decision === "approve"
              ? "Approved once"
              : approval.response?.decision === "decline"
                ? "Declined"
                : "Answered"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(12px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

const styles = stylex.create({
  list: { flexShrink: 0, maxHeight: "45vh", overflowY: "auto" },
  card: {
    padding: 12,
    marginBlock: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 10,
    fontSize: 13,
    // Requests are fetched after load, so this only plays for real arrivals.
    animationName: rise,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeOut,
    animationFillMode: "backwards",
  },
  details: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "inherit",
    fontSize: 13,
    maxHeight: "25vh",
    overflowY: "auto",
  },
  actions: { display: "flex", gap: 8, alignItems: "center" },
  approve: {
    color: colors.foreground,
    backgroundColor: { default: colors.bubble, ":hover": colors.selected },
  },
  question: { borderWidth: 0, padding: 0, marginBlock: 12 },
  option: { display: "flex", gap: 8, alignItems: "start", marginBlock: 8 },
  description: { display: "block", color: colors.muted },
  input: {
    padding: 8,
    width: "100%",
    boxSizing: "border-box",
    fontSize: 16,
    backgroundColor: colors.background,
    color: colors.foreground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
  },
});
