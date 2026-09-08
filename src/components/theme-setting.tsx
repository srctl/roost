import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { useTheme } from "../features/settings/theme-provider";
import {
  serializeTheme,
  type ThemeId,
  type ThemeMode,
  themeModes,
  themeNames,
  themePalettes,
} from "../features/settings/themes";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

const descriptions: Record<ThemeId, string> = {
  default: "Roost’s original colors",
  "rose-pine": "Dawn in light · Main in dark",
  carbonfox: "Adapted light · Carbonfox dark",
  catppuccin: "Latte in light · Mocha in dark",
};

export function ThemeSetting() {
  const { current, saved, preview, save, error } = useTheme();
  const [notice, setNotice] = useState("");
  const changed = serializeTheme(current) !== serializeTheme(saved);
  // Leaving Settings always discards an unsaved preview.
  useEffect(() => () => preview(null), [preview]);
  return (
    <section aria-labelledby="theme-label" {...stylex.props(styles.section)}>
      <h2 id="theme-label" {...stylex.props(styles.heading)}>
        Color theme
      </h2>
      <p {...stylex.props(styles.description)}>
        Try a palette across Roost, then save your favorite.
      </p>
      <RadioGroup
        aria-labelledby="theme-label"
        value={current.preset}
        onValueChange={(preset) => {
          preview({ ...current, preset: preset as ThemeId });
          setNotice("");
        }}
        {...stylex.props(styles.grid)}
      >
        {Object.entries(themeNames).map(([id, name]) => (
          <Radio.Root
            key={id}
            value={id}
            {...stylex.props(
              styles.card,
              current.preset === id && styles.selected,
            )}
          >
            <span aria-hidden="true" {...stylex.props(styles.swatches)}>
              {(["light", "dark"] as const).map((mode) => (
                <span key={mode} {...stylex.props(styles.swatchGroup)}>
                  {(["background", "bubble", "accent"] as const).map((role) => (
                    <span
                      key={role}
                      {...stylex.props(styles.swatch)}
                      style={{
                        backgroundColor:
                          themePalettes[id as ThemeId][mode][role],
                      }}
                    />
                  ))}
                </span>
              ))}
            </span>
            <span {...stylex.props(styles.name)}>
              {name}
              {current.preset === id ? " ✓" : ""}
            </span>
            <span {...stylex.props(styles.description)}>
              {descriptions[id as ThemeId]}
            </span>
          </Radio.Root>
        ))}
      </RadioGroup>
      <h3 id="theme-mode-label" {...stylex.props(styles.modeHeading)}>
        Appearance
      </h3>
      <RadioGroup
        aria-labelledby="theme-mode-label"
        value={current.mode}
        onValueChange={(mode) => {
          preview({ ...current, mode: mode as ThemeMode });
          setNotice("");
        }}
        {...stylex.props(styles.modes)}
      >
        {themeModes.map((mode) => (
          <Radio.Root
            key={mode}
            value={mode}
            {...stylex.props(
              styles.mode,
              current.mode === mode && styles.selected,
            )}
          >
            {mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}
          </Radio.Root>
        ))}
      </RadioGroup>
      <p {...stylex.props(styles.description)}>
        System follows your device. Saved in this browser for all your agents.
      </p>
      <div {...stylex.props(styles.actions)}>
        <Button
          disabled={!changed}
          xstyle={styles.save}
          onClick={() => {
            if (save()) setNotice("Theme saved.");
          }}
        >
          Save theme
        </Button>
        <Button
          disabled={!changed}
          onClick={() => {
            preview(null);
            setNotice("Preview canceled.");
          }}
        >
          Cancel preview
        </Button>
      </div>
      <p role="status" {...stylex.props(styles.status)}>
        {changed
          ? "Previewing — save to keep these colors."
          : notice || "Your saved theme is active."}
      </p>
      {changed && error && (
        <p role="alert" {...stylex.props(styles.description)}>
          {error}
        </p>
      )}
    </section>
  );
}
const styles = stylex.create({
  section: { marginTop: 32, marginBottom: 32 },
  heading: { fontSize: 14, fontWeight: 500, margin: 0 },
  description: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 1.5,
    marginBlock: 8,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
    marginTop: 16,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    textAlign: "left",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.foreground,
    cursor: "pointer",
    outlineOffset: 3,
  },
  selected: { borderColor: colors.accent, backgroundColor: colors.selected },
  name: { fontSize: 14, fontWeight: 500, marginTop: 12 },
  swatches: { display: "flex", gap: 8, flexWrap: "wrap" },
  swatchGroup: {
    display: "flex",
    overflow: "hidden",
    borderRadius: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.faint,
  },
  swatch: { width: 20, height: 20 },
  modeHeading: {
    fontSize: 12,
    fontWeight: 500,
    marginTop: 20,
    marginBottom: 8,
  },
  modes: { display: "flex", gap: 8 },
  mode: {
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    paddingInline: 16,
    paddingBlock: 12,
    fontSize: 12,
    cursor: "pointer",
    color: colors.foreground,
    outlineOffset: 3,
  },
  actions: { display: "flex", gap: 12, marginTop: 16 },
  save: {
    backgroundColor: colors.accent,
    color: colors.onAccent,
    paddingInline: 14,
    minHeight: 40,
    opacity: { default: 1, ":disabled": 0.5 },
  },
  status: { fontSize: 12, color: colors.muted, minHeight: 18, marginBottom: 0 },
});
