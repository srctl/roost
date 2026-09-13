import * as stylex from "@stylexjs/stylex";
import { motion } from "../../src/styles/motion.stylex";
import { colors } from "../../src/styles/tokens.stylex";

// Bridge the app's actual tokens to the fixture layout, including custom themes
// and system dark mode. Controls use the production StyleX Button directly.
export const theme = stylex.create({
  tokens: {
    "--jobs-background": colors.background,
    "--jobs-sidebar": colors.sidebar,
    "--jobs-surface": colors.surface,
    "--jobs-selected": colors.selected,
    "--jobs-bubble": colors.bubble,
    "--jobs-foreground": colors.foreground,
    "--jobs-muted": colors.muted,
    "--jobs-border": colors.border,
    "--jobs-accent": colors.accent,
    "--jobs-action": colors.action,
    "--jobs-on-accent": colors.onAccent,
    "--jobs-review": colors.review,
    "--jobs-motion": motion.fast,
    "--jobs-ease": motion.easeOut,
  },
});
