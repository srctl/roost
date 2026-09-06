import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import {
  toggleAgentAutomation,
  runAgentAutomation,
  deleteAgentAutomation,
} from "../features/automations/functions";
import type { Automation } from "../features/automations/schema";
import { scheduleLabel } from "../server/automations/schedule";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

type AutomationListProps = {
  agentId: string;
  automations: Automation[];
  selectedId?: string;
  busy: boolean;
  onEdit: (automation: Automation) => void;
  onAction: (
    request: () => Promise<{ ok: boolean; error?: string }>,
  ) => Promise<void>;
};

export function AutomationList({
  agentId,
  automations,
  selectedId,
  busy,
  onEdit,
  onAction,
}: AutomationListProps) {
  const [deleting, setDeleting] = useState<Automation>();

  function toggleEnabled(automation: Automation) {
    void onAction(() =>
      toggleAgentAutomation({
        data: {
          agentId,
          id: automation.id,
          revision: automation.revision,
          enabled: !automation.enabled,
        },
      }),
    );
  }

  function runNow(automation: Automation) {
    void onAction(() =>
      runAgentAutomation({
        data: { agentId, id: automation.id, requestId: crypto.randomUUID() },
      }),
    );
  }

  function confirmDelete() {
    if (!deleting) {
      return;
    }

    void onAction(async () => {
      const result = await deleteAgentAutomation({
        data: { agentId, id: deleting.id, revision: deleting.revision },
      });

      if (result.ok) {
        setDeleting(undefined);
      }

      return result;
    });
  }

  return (
    <>
      {automations.map((automation) => (
        <div
          key={automation.id}
          {...stylex.props(
            styles.row,
            selectedId === automation.id && styles.selected,
          )}
        >
          <div {...stylex.props(styles.rowHeading)}>
            <strong {...stylex.props(styles.name)}>{automation.name}</strong>
            <span {...stylex.props(styles.help)}>
              {automation.enabled ? "On" : "Paused"}
            </span>
          </div>
          <p {...stylex.props(styles.help)}>
            {scheduleLabel(automation.schedule)}
          </p>
          <p {...stylex.props(styles.help)}>
            {automation.nextRunAt
              ? `Next: ${new Date(automation.nextRunAt).toLocaleString()}`
              : "No upcoming run"}{" "}
            ·{" "}
            {automation.notification === "always"
              ? "Report every run"
              : "Only notify when needed"}
          </p>
          <div {...stylex.props(styles.actions)}>
            <Button disabled={busy} onClick={() => onEdit(automation)}>
              Edit
            </Button>
            <Button disabled={busy} onClick={() => toggleEnabled(automation)}>
              {automation.enabled ? "Pause" : "Resume"}
            </Button>
            <Button disabled={busy} onClick={() => runNow(automation)}>
              Run now
            </Button>
            <Button
              disabled={busy}
              aria-label={`Delete ${automation.name}`}
              onClick={() => setDeleting(automation)}
            >
              Delete
            </Button>
          </div>
          {deleting?.id === automation.id && (
            <div role="group" aria-label={`Delete ${deleting.name}?`}>
              <p {...stylex.props(styles.help)}>
                Delete “{deleting.name}”? This removes the schedule, cancels
                queued runs, and stops any run in progress. Past run history
                stays available. This cannot be undone.
              </p>
              <div {...stylex.props(styles.actions)}>
                <Button disabled={busy} onClick={() => setDeleting(undefined)}>
                  Cancel
                </Button>
                <Button disabled={busy} onClick={confirmDelete}>
                  Delete automation
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

const styles = stylex.create({
  help: { color: colors.muted, fontSize: 12, marginBlock: 8 },
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
});
