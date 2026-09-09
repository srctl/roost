import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import { removeAgent } from "../features/agents/functions";
import type { Agent } from "../features/agents/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";

export function AgentDeletion({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const result = await removeAgent({
        data: { agentId: agent.id, name: agent.name },
      });
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      // A fresh document also discards cached agent routes and sidebar data.
      window.location.assign("/");
    } catch {
      setError(
        "Could not confirm deletion. Reload to check whether the agent still exists before retrying.",
      );
      setBusy(false);
    }
  }

  return (
    <footer {...stylex.props(styles.footer)}>
      <Button
        ref={trigger}
        xstyle={styles.danger}
        aria-haspopup="dialog"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        Delete agent
      </Button>
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <SheetContent finalFocus={trigger}>
          <div {...stylex.props(styles.confirmation)}>
            <SheetTitle {...stylex.props(styles.title)}>
              Delete {agent.name}?
            </SheetTitle>
            <SheetDescription>
              Permanently remove this agent and its conversations, run history,
              automations, dashboards, file records and coding job records from
              Roost. Queued work will be discarded. This cannot be undone.
            </SheetDescription>
            <p>
              Memory, soul, session files, workspace files and attachments
              remain on disk, but will no longer be available through this agent
              in Roost. Shared resources, repositories and external
              infrastructure are kept.
            </p>
            <p>
              Active turns and coding workers must finish or be confirmed
              stopped before deletion. Work already shared with other agents
              stays in their conversations.
            </p>
            {error && (
              <p role="alert" {...stylex.props(styles.danger)}>
                {error}
              </p>
            )}
            <div {...stylex.props(styles.actions)}>
              <Button disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy}
                xstyle={styles.danger}
                onClick={() => void confirm()}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
            {busy && (
              <p role="status">
                Checking active work and deleting {agent.name}…
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </footer>
  );
}

const styles = stylex.create({
  footer: {
    flexShrink: 0,
    borderTop: `1px solid ${colors.border}`,
    padding: 12,
    paddingBottom: "max(12px, env(safe-area-inset-bottom))",
  },
  danger: {
    color: {
      default: "#a33232",
      "@media (prefers-color-scheme: dark)": "#ffaaaa",
    },
  },
  confirmation: { padding: 24, overflowY: "auto", overflowWrap: "anywhere" },
  title: { fontSize: 20, fontWeight: 500, margin: 0 },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 16,
    flexWrap: "wrap",
    marginTop: 24,
  },
});
