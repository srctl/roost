import { Switch } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { changeDashboardSetting } from "../features/dashboards/functions";
import {
  updateDashboardPreference,
  useDashboardsEnabled,
} from "../features/dashboards/preference";
import { colors } from "../styles/tokens.stylex";

export function DashboardSetting() {
  const enabled = useDashboardsEnabled();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  async function change(value: boolean) {
    setSaving(true);
    setError(undefined);
    try {
      const result = await changeDashboardSetting({ data: { enabled: value } });
      if (!result.ok) throw new Error(result.error);
      updateDashboardPreference(result.value.enabled);
    } catch {
      setError("Could not save this setting. Try again.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.row)}>
        <div>
          <label htmlFor="dashboards-setting" {...stylex.props(styles.label)}>
            Dashboards
          </label>
          <p id="dashboards-description" {...stylex.props(styles.description)}>
            Keep trackers, project updates, and trends outside the conversation.
            Open an agent, then choose Dashboard to see its trackers.
          </p>
        </div>
        <Switch.Root
          id="dashboards-setting"
          checked={enabled}
          disabled={saving}
          onCheckedChange={(value) => void change(value)}
          aria-describedby="dashboards-description"
          {...stylex.props(styles.switch, enabled && styles.checked)}
        >
          <Switch.Thumb
            {...stylex.props(styles.thumb, enabled && styles.thumbChecked)}
          />
        </Switch.Root>
      </div>
      <p {...stylex.props(styles.note)}>
        Off by default. Saved for all your devices. Turning this off hides
        dashboards and stops dashboard updates; saved content stays.
      </p>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </section>
  );
}

const styles = stylex.create({
  section: {
    marginTop: 28,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    paddingBottom: 24,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    justifyContent: "space-between",
  },
  label: { fontSize: 14, fontWeight: 500, cursor: "pointer" },
  description: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 0,
    maxWidth: 380,
  },
  note: { fontSize: 11, color: colors.muted, lineHeight: 1.6 },
  error: { fontSize: 12, color: colors.review },
  switch: {
    width: 36,
    height: 22,
    borderWidth: 0,
    borderRadius: 20,
    padding: 3,
    backgroundColor: colors.bubble,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    outlineOffset: 3,
  },
  checked: { backgroundColor: colors.accent },
  thumb: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    backgroundColor: colors.foreground,
    transform: "translateX(0)",
  },
  thumbChecked: {
    transform: "translateX(14px)",
    backgroundColor: colors.onAccent,
  },
});
