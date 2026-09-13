import * as stylex from "@stylexjs/stylex";
import { Schema } from "effect";
import { useId, useState } from "react";
import { Name } from "../features/agents/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

export function DisplayNameEditor({
  name,
  label,
  onSave,
  onCancel,
}: {
  name: string;
  label: string;
  onSave: (name: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      {...stylex.props(styles.form)}
      onSubmit={async (event) => {
        event.preventDefault();
        let trimmed: string;
        try {
          trimmed = Schema.decodeUnknownSync(Name)(value);
        } catch {
          setError("Enter a name between 1 and 60 characters.");
          return;
        }
        setSaving(true);
        setError("");
        try {
          await onSave(trimmed);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Could not save. Try again.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        disabled={saving}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
        {...stylex.props(styles.input)}
      />
      <div {...stylex.props(styles.actions)}>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          disabled={saving}
          onClick={() => {
            setValue(name);
            setError("");
            onCancel?.();
          }}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export const nameEditorStyles = stylex.create({
  control: {
    backgroundColor: colors.background,
    color: colors.foreground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    padding: 8,
    minWidth: 0,
    width: "100%",
    font: "inherit",
  },
});
const styles = stylex.create({
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    fontSize: 12,
  },
  input: {
    backgroundColor: colors.background,
    color: colors.foreground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    padding: 8,
    minWidth: 0,
    width: "100%",
    fontSize: { default: 14, "@media (max-width: 700px)": 16 },
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8 },
});
