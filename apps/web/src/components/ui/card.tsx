import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";
import { motion } from "../../styles/motion.stylex";
import { colors, radii, shadows } from "../../styles/tokens.stylex";

// Adapted from shadcn/ui's Card; see THIRD_PARTY_NOTICES.md.
type Props = Omit<ComponentProps<"div">, "className" | "style"> & {
  xstyle?: stylex.StyleXStyles;
};

export function Card({ xstyle, ...props }: Props) {
  return (
    <div
      data-slot="card"
      {...props}
      {...stylex.props(cardStyles.card, xstyle)}
    />
  );
}

export function CardHeader({ xstyle, ...props }: Props) {
  return (
    <div
      data-slot="card-header"
      {...props}
      {...stylex.props(styles.header, xstyle)}
    />
  );
}

export function CardContent({ xstyle, ...props }: Props) {
  return (
    <div
      data-slot="card-content"
      {...props}
      {...stylex.props(styles.content, xstyle)}
    />
  );
}

/* `card` also styles links and buttons that render as a card. */
export const cardStyles = stylex.create({
  card: {
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    color: colors.foreground,
    boxShadow: shadows.xs,
    outlineOffset: 2,
    transitionProperty: "border-color, box-shadow, transform",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut,
  },
  interactive: {
    textDecoration: "none",
    color: colors.foreground,
    cursor: "pointer",
    borderColor: {
      default: colors.border,
      "@media (hover: hover)": {
        ":hover": `color-mix(in srgb, ${colors.foreground} 18%, ${colors.border})`,
      },
    },
    boxShadow: {
      default: shadows.xs,
      "@media (hover: hover)": { ":hover": shadows.md },
    },
    transform: {
      default: "translateY(0)",
      "@media (hover: hover)": { ":hover": "translateY(-1px)" },
    },
  },
});

const styles = stylex.create({
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 20,
    paddingBottom: 0,
  },
  content: { padding: 20 },
});
