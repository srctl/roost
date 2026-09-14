import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { useOpenAfterMount } from "../../features/motion";
import { motion } from "../../styles/motion.stylex";
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
  // Owned open state lets the panel animate out before the owner unmounts it.
  const [open, setOpen] = useState(true);
  const shown = useOpenAfterMount(open);

  return (
    <Dialog.Root
      open={shown}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClose();
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
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    transitionProperty: "opacity",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut,
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
    boxShadow: "0 24px 60px #00000022",
    overflowY: "auto",
    scrollbarWidth: "thin",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
    lineHeight: 1.6,
    // Slides in from the right on desktop and up from the bottom on phones.
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    transform: {
      default: "translate(0, 0)",
      ":is([data-starting-style], [data-ending-style])": {
        default: "translate(24px, 0)",
        "@media (max-width: 700px)": "translate(0, 48px)",
      },
    },
    transitionProperty: "opacity, transform",
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut,
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
