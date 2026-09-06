import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { Route } from "../routes/__root";
import { colors } from "../styles/tokens.stylex";
import { Sidebar } from "./sidebar";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";

export function MobileNavigation() {
  const agents = Route.useLoaderData();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 701px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={<Button xstyle={styles.trigger} />}
        aria-label="Open navigation"
      >
        <Icon name="menu" size={20} />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup {...stylex.props(styles.drawer)}>
          <Dialog.Title {...stylex.props(styles.srOnly)}>
            Navigation
          </Dialog.Title>
          <Sidebar
            agents={agents.ok ? agents.value : []}
            drawer
            onCollapse={() => setOpen(false)}
            onNavigate={() => setOpen(false)}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
const styles = stylex.create({
  trigger: {
    display: { default: "none", "@media (max-width: 700px)": "inline-flex" },
    width: 44,
    height: 44,
    padding: 0,
    flexShrink: 0,
    color: colors.foreground,
  },
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
    transitionDuration: {
      default: "160ms",
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
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
    transitionDuration: {
      default: "180ms",
      "@media (prefers-reduced-motion: reduce)": "0ms",
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
