import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import { motion } from "../../styles/motion.stylex";
import { colors, radii, shadows } from "../../styles/tokens.stylex";

// Adapted from shadcn/ui's Base UI button; see THIRD_PARTY_NOTICES.md.
// `ghost` stays the default because most call sites are quiet toolbar actions.
export type ButtonVariant =
  | "ghost"
  | "default"
  | "secondary"
  | "outline"
  | "destructive";
export type ButtonSize = "sm" | "default" | "lg" | "icon";

export function Button({
  xstyle,
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: ButtonPrimitive.Props & {
  xstyle?: stylex.StyleXStyles;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const base = stylex.props(
    styles.button,
    variants[variant],
    size !== "sm" && sizes[size],
    xstyle,
  );

  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      {...props}
      className={(state) =>
        [
          base.className,
          typeof className === "function" ? className(state) : className,
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  );
}

const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: { default: 28, "@media (max-width: 700px)": 44 },
    minWidth: { default: 0, "@media (max-width: 700px)": 44 },
    gap: 6,
    paddingBlock: 5,
    paddingInline: 8,
    borderWidth: 0,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: radii.sm,
    fontSize: 12,
    whiteSpace: "nowrap",
    fontWeight: 450,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.5 },
    outlineOffset: 2,
    transform: { default: "scale(1)", ":not(:disabled):active": "scale(0.97)" },
    transitionProperty:
      "background-color, border-color, color, box-shadow, transform, opacity",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
  },
});

const variants = stylex.create({
  ghost: {
    // A translucent wash of the text colour reads on every surface and theme.
    backgroundColor: {
      default: "transparent",
      "@media (hover: hover)": {
        ":not(:disabled):hover":
          "color-mix(in srgb, currentColor 8%, transparent)",
      },
    },
    color: {
      default: colors.muted,
      "@media (hover: hover)": { ":not(:disabled):hover": colors.foreground },
    },
  },
  default: {
    backgroundColor: {
      default: colors.accent,
      "@media (hover: hover)": {
        ":not(:disabled):hover": `color-mix(in srgb, ${colors.accent} 88%, ${colors.foreground})`,
      },
    },
    color: colors.onAccent,
    fontWeight: 500,
    boxShadow: shadows.xs,
  },
  secondary: {
    backgroundColor: {
      default: colors.bubble,
      "@media (hover: hover)": { ":not(:disabled):hover": colors.selected },
    },
    color: colors.foreground,
    fontWeight: 500,
  },
  outline: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: {
      default: colors.background,
      "@media (hover: hover)": { ":not(:disabled):hover": colors.bubble },
    },
    color: colors.foreground,
    fontWeight: 500,
    boxShadow: shadows.xs,
  },
  destructive: {
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.review} 12%, transparent)`,
      "@media (hover: hover)": {
        ":not(:disabled):hover": `color-mix(in srgb, ${colors.review} 20%, transparent)`,
      },
    },
    color: colors.review,
    fontWeight: 500,
  },
});

const sizes = stylex.create({
  default: {
    minHeight: { default: 34, "@media (max-width: 700px)": 44 },
    paddingInline: 14,
    fontSize: 13,
    borderRadius: radii.md,
  },
  lg: {
    minHeight: 40,
    paddingInline: 18,
    fontSize: 14,
    borderRadius: radii.md,
  },
  icon: { padding: 0, width: 32, height: 32, borderRadius: radii.md },
});
