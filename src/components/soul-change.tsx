import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { getSoulHistory, undoAgentSoul } from "../features/agents/functions";
import type { SoulChange } from "../server/agents/soul.server";
import { colors } from "../styles/tokens.stylex";
import { Inspector } from "./ui/inspector";
import { Button } from "./ui/button";

function changedPassages(before: string, after: string) {
  const left = before.trimEnd().split("\n"),
    right = after.trimEnd().split("\n");
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start++;
  let end = 0;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  )
    end++;
  return {
    before: left.slice(start, left.length - end).join("\n"),
    after: right.slice(start, right.length - end).join("\n"),
  };
}
export function SoulChangeDetails({
  agentId,
  id,
  onClose,
  onUndo,
}: {
  agentId: string;
  id: string;
  onClose: () => void;
  onUndo?: () => void;
}) {
  const [change, setChange] = useState<SoulChange>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [undone, setUndone] = useState(false);
  useEffect(() => {
    let active = true;
    void getSoulHistory({ data: { agentId } })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const found = result.value.find((c) => c.id === id);
        setChange(found);
        if (!found) setError("Change not found.");
      })
      .catch(() => {
        if (active) setError("Could not load this change.");
      });
    return () => {
      active = false;
    };
  }, [agentId, id]);
  async function undo() {
    setBusy(true);
    setError("");
    try {
      const result = await undoAgentSoul({ data: { agentId, id } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUndone(true);
      onUndo?.();
    } catch {
      setError("Could not undo this change.");
    } finally {
      setBusy(false);
    }
  }
  const passage = change && changedPassages(change.before, change.after);
  return (
    <Inspector title="Soul change" onClose={onClose}>
      {change ? (
        <>
          <p>{change.reason}</p>
          <p {...stylex.props(styles.meta)}>
            {change.source === "agent" ? "Updated by agent" : "Updated by you"}{" "}
            · {new Date(change.createdAt).toLocaleString()}
          </p>
          <h3 {...stylex.props(styles.label)}>Before</h3>
          <pre {...stylex.props(styles.content)}>
            {passage?.before || "(No lines)"}
          </pre>
          <h3 {...stylex.props(styles.label)}>After</h3>
          <pre {...stylex.props(styles.content)}>
            {passage?.after || "(No lines)"}
          </pre>
          <Button disabled={busy || undone} onClick={() => void undo()}>
            {undone ? "Undone" : busy ? "Undoing…" : "Undo change"}
          </Button>
          <p {...stylex.props(styles.meta)}>
            Undo restores the previous soul only if it hasn’t changed again.
          </p>
        </>
      ) : (
        !error && <p>Loading change…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </Inspector>
  );
}
const styles = stylex.create({
  meta: { fontSize: 12, color: colors.muted },
  label: { fontSize: 12, fontWeight: 500, marginTop: 24 },
  content: {
    fontFamily: "monospace",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 6,
  },
});
