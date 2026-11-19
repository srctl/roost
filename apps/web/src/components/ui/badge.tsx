import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";
import { colors, radii } from "../../styles/tokens.stylex";

// Adapted from shadcn/ui's Badge; see THIRD_PARTY_NOTICES.md.
export function Badge({
  variant = "secondary",
  xstyle,
  ...props
}: Omit<ComponentProps<"span">, "className" | "style"> & {
  variant?: "secondary" | "outline" | "accent" | "destructive";
  xstyle?: stylex.StyleXStyles;
}) {
  return (
    <span
      data-slot="badge"
      {...props}
      {...stylex.props(styles.badge, styles[variant], xstyle)}
    />
  );
}

const styles = stylex.create({
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingBlock: 1,
    paddingInline: 7,
    borderRadius: radii.full,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: 1.6,
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  secondary: { backgroundColor: colors.bubble, color: colors.muted },
  outline: { borderColor: colors.border, color: colors.muted },
  accent: {
    backgroundColor: `color-mix(in srgb, ${colors.accent} 14%, transparent)`,
    color: colors.accent,
  },
  destructive: {
    backgroundColor: `color-mix(in srgb, ${colors.review} 14%, transparent)`,
    color: colors.review,
  },
});
