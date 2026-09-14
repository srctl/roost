import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { type RefObject, useEffect, useState } from "react";
import { useOpenAfterMount } from "../features/motion";
import { listenForNavigationSwipe } from "../features/navigation-swipe";
import { Route } from "../routes/__root";
import { motion } from "../styles/motion.stylex";
import { colors } from "../styles/tokens.stylex";
import { Sidebar } from "./sidebar";

export function MobileNavigationDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const agents = Route.useLoaderData();
  const shown = useOpenAfterMount(open);
  const [drawer, setDrawer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!drawer || !shown) return;
    const mobile = window.matchMedia("(max-width: 700px)");
    return listenForNavigationSwipe(
      drawer,
      () => mobile.matches,
      () => onOpenChange(false),
      "left",
    );
  }, [drawer, shown, onOpenChange]);

  return (
    <Dialog.Root open={shown} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup
          ref={setDrawer}
          finalFocus={trigger}
          {...stylex.props(styles.drawer)}
        >
          <Dialog.Title {...stylex.props(styles.srOnly)}>
            Navigation
          </Dialog.Title>
          <Sidebar
            agents={agents.ok ? agents.value : []}
            drawer
            onCollapse={() => onOpenChange(false)}
            onNavigate={() => onOpenChange(false)}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
    backgroundColor: "#00000066",
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    transitionProperty: "opacity",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut,
  },
  drawer: {
    position: "fixed",
    left: 0,
    top: 0,
    bottom: 0,
    width: "min(320px, calc(100vw - 48px))",
    zIndex: 31,
    backgroundColor: colors.sidebar,
    color: colors.foreground,
    overflowY: "auto",
    overscrollBehavior: "contain",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 14,
    transform: {
      default: "translateX(0)",
      ":is([data-starting-style], [data-ending-style])": "translateX(-100%)",
    },
    transitionProperty: "transform",
    transitionDuration: motion.slow,
    transitionTimingFunction: {
      default: motion.easeOut,
      ":is([data-ending-style])": motion.easeInOut,
    },
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
