import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import {
  getAgentRun,
  getAgentAutomations,
  toggleAgentAutomation,
  runAgentAutomation,
  stopAgentRun,
  deleteAgentAutomation,
} from "../features/automations/functions";
import type { Automation } from "../features/automations/schema";
import type { Run } from "../server/runs/store.server";
import type { Message } from "../features/chat/schema";
import { scheduleLabel } from "../server/automations/schedule";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";
import { Inspector } from "./ui/inspector";
import { AutomationForm } from "./automation-form";
import { MessageContent } from "./conversation/message-content";

export function RunDetails({
  run,
  onClose,
}: {
  run: Run;
  onClose: () => void;
}) {
  const messages = (JSON.parse(run.messages) as Message[]).filter(
    (message) => message.role !== "user",
  );
  return (
    <Inspector title="Run details" onClose={onClose}>
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
      {messages
        .filter((m) => m.role !== "user")
        .map((m) => (
          <div key={m.id} {...stylex.props(styles.output)}>
            {m.role === "activity" ? (
              <details>
                <summary>
                  {m.title ?? "Activity"} · {m.status}
                </summary>
                <pre {...stylex.props(styles.text)}>{m.details}</pre>
                <pre {...stylex.props(styles.text)}>{m.text}</pre>
              </details>
            ) : (
              <MessageContent>{m.text}</MessageContent>
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
        if (!active) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRun(result.value);
        if (["queued", "running"].includes(result.value.status))
          timer = setTimeout(() => void load(), 1000);
      } catch {
        if (active) setError("Could not load this run.");
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [agentId, id]);
  return run ? (
    <RunDetails run={run} onClose={onClose} />
  ) : (
    <Inspector title="Run details" onClose={onClose}>
      <p>{error || "Loading…"}</p>
    </Inspector>
  );
}
export function AgentAutomationSettings({
  agentId,
  selectedId,
}: {
  agentId: string;
  selectedId?: string;
}) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Automation | "new">();
  const [deleting, setDeleting] = useState<Automation>();
  const [runId, setRunId] = useState<string>();
  async function reload() {
    const result = await getAgentAutomations({ data: { agentId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAutomations(result.value.automations);
    setRuns(result.value.runs);
    setLoaded(true);
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await getAgentAutomations({ data: { agentId } });
        if (!active) return;
        if (result.ok) {
          setAutomations(result.value.automations);
          setRuns(result.value.runs);
          setLoaded(true);
        } else setError(result.error);
      } catch {
        if (active) setError("Could not load automations.");
      }
      if (active) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [agentId]);
  async function action(
    request: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await request();
      if (!result.ok) {
        setError(result.error ?? "Could not update.");
        return;
      }
      await reload();
    } catch {
      setError("Could not confirm the change. Reload before trying again.");
    } finally {
      setBusy(false);
    }
  }
  const viewed = runs.find((r) => r.id === runId);
  return (
    <section aria-label="Automations">
      <p {...stylex.props(styles.help)}>
        Give this agent work to do on a schedule. Roost and this machine need to
        stay running.
      </p>
      {editing ? (
        <AutomationForm
          key={editing === "new" ? "new" : editing.id}
          agentId={agentId}
          automation={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void reload().catch(() =>
              setError("Could not reload automations."),
            );
          }}
        />
      ) : (
        <>
          <Button onClick={() => setEditing("new")}>＋ New automation</Button>
          {!loaded && !error && <p>Loading…</p>}
          {loaded &&
            selectedId &&
            !automations.some((a) => a.id === selectedId) && (
              <p {...stylex.props(styles.help)}>
                This automation is no longer available.
              </p>
            )}
          {loaded && !automations.length && (
            <p {...stylex.props(styles.help)}>
              No automations yet. You can create one here or ask your agent in
              chat.
            </p>
          )}
          {automations.map((a) => (
            <div
              key={a.id}
              {...stylex.props(
                styles.row,
                selectedId === a.id && styles.selected,
              )}
            >
              <div {...stylex.props(styles.rowHeading)}>
                <strong {...stylex.props(styles.name)}>{a.name}</strong>
                <span {...stylex.props(styles.help)}>
                  {a.enabled ? "On" : "Paused"}
                </span>
              </div>
              <p {...stylex.props(styles.help)}>{scheduleLabel(a.schedule)}</p>
              <p {...stylex.props(styles.help)}>
                {a.nextRunAt
                  ? `Next: ${new Date(a.nextRunAt).toLocaleString()}`
                  : "No upcoming run"}{" "}
                ·{" "}
                {a.notification === "always"
                  ? "Report every run"
                  : "Only notify when needed"}
              </p>
              <div {...stylex.props(styles.actions)}>
                <Button disabled={busy} onClick={() => setEditing(a)}>
                  Edit
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      toggleAgentAutomation({
                        data: {
                          agentId,
                          id: a.id,
                          revision: a.revision,
                          enabled: !a.enabled,
                        },
                      }),
                    )
                  }
                >
                  {a.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      runAgentAutomation({
                        data: {
                          agentId,
                          id: a.id,
                          requestId: crypto.randomUUID(),
                        },
                      }),
                    )
                  }
                >
                  Run now
                </Button>
                <Button
                  disabled={busy}
                  aria-label={`Delete ${a.name}`}
                  onClick={() => setDeleting(a)}
                >
                  Delete
                </Button>
              </div>
              {deleting?.id === a.id && (
                <div role="group" aria-label={`Delete ${deleting.name}?`}>
                  <p {...stylex.props(styles.help)}>
                    Delete “{deleting.name}”? This removes the schedule, cancels
                    queued runs, and stops any run in progress. Past run history
                    stays available. This cannot be undone.
                  </p>
                  <div {...stylex.props(styles.actions)}>
                    <Button
                      disabled={busy}
                      onClick={() => setDeleting(undefined)}
                    >
                      Cancel
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const result = await deleteAgentAutomation({
                            data: {
                              agentId,
                              id: deleting.id,
                              revision: deleting.revision,
                            },
                          });
                          if (result.ok) setDeleting(undefined);
                          return result;
                        })
                      }
                    >
                      Delete automation
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      <h3 {...stylex.props(styles.heading)}>Recent runs</h3>
      <p {...stylex.props(styles.help)}>
        Includes chats, delegated tasks, and scheduled runs. Pausing cancels
        queued work; use Stop for a run already in progress.
      </p>
      {!runs.length && <p {...stylex.props(styles.help)}>No runs yet.</p>}
      {runs.map((run) => (
        <div key={run.id} {...stylex.props(styles.run)}>
          <Button onClick={() => setRunId(run.id)} xstyle={styles.runButton}>
            <span {...stylex.props(styles.runName)}>
              {run.kind !== "automation"
                ? {
                    chat: "Chat",
                    delegation: "Delegated task",
                    handoff: "Specialist update",
                  }[run.kind]
                : ((
                    JSON.parse(
                      run.automationSnapshot ?? "null",
                    ) as Automation | null
                  )?.name ?? "Automation")}
            </span>
            <span {...stylex.props(styles.help)}>
              {new Date(run.createdAt).toLocaleString()} · {run.status}
            </span>
          </Button>
          {["queued", "running"].includes(run.status) && (
            <Button
              disabled={busy}
              onClick={() =>
                void action(() =>
                  stopAgentRun({ data: { agentId, id: run.id } }),
                )
              }
            >
              Stop
            </Button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      {viewed && (
        <RunDetails run={viewed} onClose={() => setRunId(undefined)} />
      )}
    </section>
  );
}
const styles = stylex.create({
  help: { color: colors.muted, fontSize: 12, marginBlock: 8 },
  heading: { fontSize: 13, fontWeight: 500, marginTop: 28, marginBottom: 8 },
  row: {
    paddingBlock: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  selected: { borderBottomColor: colors.accent },
  rowHeading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: { fontWeight: 500 },
  actions: { display: "flex", flexWrap: "wrap", gap: 4 },
  run: {
    display: "flex",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    paddingBlock: 6,
  },
  runButton: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    textAlign: "left",
    gap: 0,
  },
  runName: {
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  text: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 },
  output: {
    marginBlock: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
});
