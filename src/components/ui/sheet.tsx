import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";

// shadcn Sheet composition, using Base UI with Roost's StyleX theme.
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;

export function SheetContent({ children }: { children: ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
      <Dialog.Popup {...stylex.props(styles.panel)}>{children}</Dialog.Popup>
    </Dialog.Portal>
  );
}

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 10,
    backgroundColor: "#00000050",
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    transitionProperty: "opacity",
    transitionDuration: {
      default: "180ms",
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
  },
  panel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 11,
    width: { default: 520, "@media (max-width: 700px)": "100vw" },
    maxWidth: "100vw",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    boxShadow: "-12px 0 40px #00000018",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 13,
    lineHeight: 1.6,
    transform: {
      default: "translateX(0)",
      ":is([data-starting-style], [data-ending-style])": "translateX(100%)",
    },
    transitionProperty: "transform",
    transitionDuration: {
      default: "180ms",
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
  },
});
