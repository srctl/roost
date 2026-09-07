import { lazy, Suspense, useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";

const MobileNavigationDialog = lazy(() =>
  import("./mobile-navigation-dialog").then((module) => ({
    default: module.MobileNavigationDialog,
  })),
);

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 701px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <>
      <Button
        ref={trigger}
        xstyle={styles.trigger}
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <Icon name="menu" size={20} />
      </Button>
      {mounted && (
        <Suspense fallback={null}>
          <MobileNavigationDialog
            open={open}
            onOpenChange={setOpen}
            trigger={trigger}
          />
        </Suspense>
      )}
    </>
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
});
