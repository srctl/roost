import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { createDashboardTracker } from "../features/dashboards/functions";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

export function CreateTracker({
  agentId,
  onCreated,
}: {
  agentId: string;
  onCreated: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [kind, setKind] = useState<"todo" | "calories">("todo");
  const [title, setTitle] = useState("To-do list");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState<{
    key: string;
    kind: "todo" | "calories";
    title: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  return (
    <div {...stylex.props(styles.container)}>
      <Button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={saving || !hydrated}
      >
        Add tracker
      </Button>
      {open && (
        <form
          aria-label="New tracker"
          {...stylex.props(styles.form)}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim() || saving) return;
            key.current ??= `${kind}-${crypto.randomUUID()}`;
            setSaving(true);
            setError(null);
            const input = retry ?? {
              key: key.current,
              kind,
              title: title.trim(),
            };
            try {
              const result = await createDashboardTracker({
                data: { agentId, ...input },
              });
              setRetry(null);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              // Creation has succeeded even if refreshing the surrounding dashboard fails.
              key.current = null;
              setOpen(false);
              const notice = await onCreated().catch(
                () => "Tracker created. Refresh the dashboard to see it.",
              );
              if (notice) setError(notice);
            } catch {
              setRetry(input);
              setError(
                "Could not confirm the new tracker. Try again to check it.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <label {...stylex.props(styles.field)}>
            Type
            <select
              aria-label="Tracker type"
              value={kind}
              disabled={saving || retry !== null}
              {...stylex.props(styles.input)}
              onChange={(event) => {
                const next = event.target.value as "todo" | "calories";
                setKind(next);
                setTitle(next === "todo" ? "To-do list" : "Calorie log");
              }}
            >
              <option value="todo">To-do list</option>
              <option value="calories">Calorie log</option>
            </select>
          </label>
          <label {...stylex.props(styles.field, styles.name)}>
            Name
            <input
              aria-label="Tracker name"
              value={title}
              maxLength={100}
              disabled={saving || retry !== null}
              onChange={(event) => setTitle(event.target.value)}
              {...stylex.props(styles.input)}
            />
          </label>
          <Button
            type="submit"
            disabled={saving || !title.trim()}
            xstyle={styles.create}
          >
            {saving ? "Creating…" : retry ? "Retry creation" : "Create tracker"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

const styles = stylex.create({
  container: { marginBottom: 16 },
  form: {
    display: "flex",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
    marginBottom: 20,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    color: colors.muted,
  },
  name: { flex: "1 1 170px", minWidth: 0, maxWidth: 320 },
  input: {
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    color: colors.foreground,
    paddingInline: 10,
    font: "inherit",
    fontSize: 16,
    outlineOffset: 3,
  },
  create: {
    minHeight: 44,
    paddingInline: 14,
    color: colors.onAccent,
    backgroundColor: colors.accent,
  },
  error: { fontSize: 12, lineHeight: 1.6, color: colors.muted },
});
