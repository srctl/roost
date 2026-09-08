import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import {
  getAgentAutomations,
  stopAgentRun,
} from "../features/automations/functions";
import type { Automation } from "../features/automations/schema";
import type { RunSummary } from "../server/runs/store.server";
import { colors } from "../styles/tokens.stylex";
import { AutomationForm } from "./automation-form";
import { AutomationList } from "./automation-list";
import { RunInspector } from "./run-details";
import { Button } from "./ui/button";

function runLabel(run: RunSummary): string {
  if (run.kind === "automation") {
    return run.automationName ?? "Automation";
  }

  return {
    chat: "Chat",
    delegation: "Delegated task",
    handoff: "Specialist update",
    reflection: "Reflection",
  }[run.kind];
}

export function AgentAutomationSettings({
  agentId,
  selectedId,
}: {
  agentId: string;
  selectedId?: string;
}) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Automation | "new">();
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

        if (!active) {
          return;
        }

        if (result.ok) {
          setAutomations(result.value.automations);
          setRuns(result.value.runs);
          setLoaded(true);
        } else {
          setError(result.error);
        }
      } catch {
        if (active) {
          setError("Could not load automations.");
        }
      }

      if (active) {
        timer = setTimeout(() => void poll(), 2000);
      }
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
          <AutomationList
            agentId={agentId}
            automations={automations}
            selectedId={selectedId}
            busy={busy}
            onEdit={setEditing}
            onAction={action}
          />
        </>
      )}
      <h3 {...stylex.props(styles.heading)}>Recent runs</h3>
      <p {...stylex.props(styles.help)}>
        Includes chats, delegated tasks, and scheduled runs. Pausing cancels
        queued work; use Stop for a run already in progress.
      </p>
      {loaded && !runs.length && (
        <p {...stylex.props(styles.help)}>No runs yet.</p>
      )}
      {runs.map((run) => (
        <div key={run.id} {...stylex.props(styles.run)}>
          <Button onClick={() => setRunId(run.id)} xstyle={styles.runButton}>
            <span {...stylex.props(styles.runName)}>{runLabel(run)}</span>
            <span {...stylex.props(styles.help)}>
              {new Date(run.createdAt).toLocaleString()} · {run.status}
            </span>
          </Button>
          {["queued", "running", "steering"].includes(run.status) && (
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
      {runId && (
        <RunInspector
          key={runId}
          agentId={agentId}
          id={runId}
          onClose={() => setRunId(undefined)}
        />
      )}
    </section>
  );
}

const styles = stylex.create({
  help: { color: colors.muted, fontSize: 12, marginBlock: 8 },
  heading: { fontSize: 13, fontWeight: 500, marginTop: 28, marginBottom: 8 },
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
});
