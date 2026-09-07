import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { getAgentRun } from "../features/automations/functions";
import type { Message } from "../features/chat/schema";
import type { Run } from "../server/runs/store.server";
import { colors } from "../styles/tokens.stylex";
import { MessageContent } from "./conversation/message-content";
import { Inspector } from "./ui/inspector";

export function RunDetails({
  run,
  onClose,
  loadError,
}: {
  run: Run;
  onClose: () => void;
  loadError?: string;
}) {
  const messages = (JSON.parse(run.messages) as Message[]).filter(
    (message) => message.role !== "user",
  );

  return (
    <Inspector title="Run details" onClose={onClose}>
      {loadError && <p role="alert">{loadError}</p>}
      <p>
        {run.status} · {new Date(run.createdAt).toLocaleString()}
      </p>
      <p {...stylex.props(styles.help)}>
        Soul revision {run.soulRevision?.slice(0, 12) ?? "Not started"}
      </p>
      {run.error && <p role="alert">{run.error}</p>}
      <h3 {...stylex.props(styles.heading)}>Task</h3>
      <p {...stylex.props(styles.text)}>{run.prompt}</p>
      <h3 {...stylex.props(styles.heading)}>Output</h3>
      {!messages.length && (
        <p {...stylex.props(styles.help)}>No output recorded yet.</p>
      )}
      {messages.map((message) => (
        <div key={message.id} {...stylex.props(styles.output)}>
          {message.role === "activity" ? (
            <details>
              <summary>
                {message.title ?? "Activity"} · {message.status}
              </summary>
              <pre {...stylex.props(styles.text)}>{message.details}</pre>
              <pre {...stylex.props(styles.text)}>{message.text}</pre>
            </details>
          ) : (
            <MessageContent>{message.text}</MessageContent>
          )}
        </div>
      ))}
    </Inspector>
  );
}

export function RunInspector({
  agentId,
  id,
  onClose,
}: {
  agentId: string;
  id: string;
  onClose: () => void;
}) {
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function load() {
      try {
        const result = await getAgentRun({ data: { agentId, id } });

        if (!active) {
          return;
        }

        if (result.ok) {
          setRun(result.value);
          setError("");
          if (!["queued", "running"].includes(result.value.status)) return;
        } else {
          setError(result.error);
        }
      } catch {
        if (active) {
          setError("Could not load this run.");
        }
      }

      if (active) timer = setTimeout(() => void load(), 1000);
    }

    void load();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [agentId, id]);

  return run ? (
    <RunDetails run={run} onClose={onClose} loadError={error} />
  ) : (
    <Inspector title="Run details" onClose={onClose}>
      <p>{error || "Loading…"}</p>
    </Inspector>
  );
}

const styles = stylex.create({
  help: { color: colors.muted, fontSize: 12, marginBlock: 8 },
  heading: { fontSize: 13, fontWeight: 500, marginTop: 28, marginBottom: 8 },
  text: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 },
  output: {
    marginBlock: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
});
