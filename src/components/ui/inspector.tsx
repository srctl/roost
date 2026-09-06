import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors } from "../../styles/tokens.stylex";
import { Button } from "./button";
import { Icon } from "./primitives";

export function Inspector({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.panel)}>
          <div {...stylex.props(styles.heading)}>
            <Dialog.Title {...stylex.props(styles.title)}>{title}</Dialog.Title>
            <Dialog.Close render={<Button />} aria-label="Close details">
              <Icon name="close" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "#00000060",
    zIndex: 20,
  },
  panel: {
    position: "fixed",
    top: { default: 24, "@media (max-width: 700px)": 0 },
    bottom: { default: 24, "@media (max-width: 700px)": 0 },
    right: { default: 24, "@media (max-width: 700px)": 0 },
    width: { default: 600, "@media (max-width: 700px)": "100vw" },
    maxWidth: {
      default: "calc(100vw - 48px)",
      "@media (max-width: 700px)": "100vw",
    },
    backgroundColor: colors.background,
    color: colors.foreground,
    zIndex: 21,
    paddingInline: { default: 24, "@media (max-width: 700px)": 16 },
    paddingTop: {
      default: 24,
      "@media (max-width: 700px)": "max(12px, env(safe-area-inset-top))",
    },
    paddingBottom: {
      default: 24,
      "@media (max-width: 700px)": "max(16px, env(safe-area-inset-bottom))",
    },
    borderRadius: { default: 12, "@media (max-width: 700px)": 0 },
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    overflowY: "auto",
    scrollbarWidth: "thin",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
    lineHeight: 1.6,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: 500, margin: 0 },
});
