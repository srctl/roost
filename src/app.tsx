import * as stylex from "@stylexjs/stylex";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { MobileNavigation } from "./components/mobile-navigation";
import { Sidebar } from "./components/sidebar";
import { Button } from "./components/ui/button";
import { Icon } from "./components/ui/primitives";
import { AgentActivityProvider } from "./features/agents/activity";
import { useAgentStartup } from "./features/agents/use-agent-startup";
import { PreferencesProvider } from "./features/settings/preferences";
import { Route } from "./routes/__root";
import { colors } from "./styles/tokens.stylex";

export function App() {
  const [collapsed, setCollapsed] = useState(false);
  const agents = Route.useLoaderData();
  useAgentStartup(agents.ok ? agents.value : undefined);
  const agentPage = useRouterState({
    select: (state) =>
      state.matches.some(
        (match) =>
          match.routeId === "/agents/$agentId" ||
          match.routeId === "/agents/$agentId_/dashboard",
      ),
  });
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const resize = () => {
      // Safari pans the visual viewport when opening the keyboard. Follow both
      // its size and position, but leave pinch zoom to the browser.
      if (viewport.scale !== 1 || !shell.current) return;
      const style = shell.current.style;
      const keyboardOpen =
        document.activeElement?.matches("input, textarea, [contenteditable]") &&
        document.documentElement.clientHeight - viewport.height > 100;
      // Standalone iOS can retain a shorter visual viewport after dismissing
      // the keyboard. Let CSS fill the screen whenever no keyboard is active.
      if (keyboardOpen) {
        style.setProperty("--roost-viewport-height", `${viewport.height}px`);
        style.setProperty("--roost-viewport-top", `${viewport.offsetTop}px`);
      } else {
        style.removeProperty("--roost-viewport-height");
        style.removeProperty("--roost-viewport-top");
      }
      style.setProperty(
        "--roost-bottom-inset",
        keyboardOpen ? "0px" : "env(safe-area-inset-bottom)",
      );
    };

    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    window.addEventListener("pageshow", resize);
    document.addEventListener("visibilitychange", resize);
    document.addEventListener("focusin", resize);
    document.addEventListener("focusout", resize);

    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pageshow", resize);
      document.removeEventListener("visibilitychange", resize);
      document.removeEventListener("focusin", resize);
      document.removeEventListener("focusout", resize);
    };
  }, []);
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .catch((error: unknown) => console.warn("Offline setup failed", error));
    }
  }, []);

  return (
    <PreferencesProvider>
      <AgentActivityProvider>
        <div ref={shell} {...stylex.props(styles.app)}>
          {!collapsed && (
            <div {...stylex.props(styles.desktopNavigation)}>
              <Sidebar
                agents={agents.ok ? agents.value : []}
                onCollapse={() => setCollapsed(true)}
              />
            </div>
          )}
          {collapsed && (
            <div {...stylex.props(styles.expand)}>
              <Button
                aria-label="Expand sidebar"
                aria-expanded={false}
                aria-controls="agent-sidebar"
                onClick={() => setCollapsed(false)}
              >
                <Icon name="panel" />
              </Button>
            </div>
          )}
          {!agentPage && (
            <header {...stylex.props(styles.mobileHeader)}>
              <MobileNavigation />
              <Link to="/" {...stylex.props(styles.brand)}>
                roost
              </Link>
            </header>
          )}
          <main
            {...stylex.props(
              styles.workspace,
              agentPage && styles.chatWorkspace,
            )}
          >
            {!agents.ok && <p role="alert">{agents.error}</p>}
            <Outlet />
          </main>
        </div>
      </AgentActivityProvider>
    </PreferencesProvider>
  );
}

const styles = stylex.create({
  desktopNavigation: {
    display: { default: "flex", "@media (max-width: 700px)": "none" },
    position: "sticky",
    top: 0,
    height: "100dvh",
    alignSelf: "flex-start",
    flexShrink: 0,
  },
  expand: {
    padding: 12,
    flexShrink: 0,
    display: { default: "block", "@media (max-width: 700px)": "none" },
  },
  mobileHeader: {
    display: { default: "none", "@media (max-width: 700px)": "flex" },
    alignItems: "center",
    gap: 4,
    minHeight: 56,
    flexShrink: 0,
    paddingInline: 8,
    paddingTop: "env(safe-area-inset-top)",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  brand: {
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: "-0.7px",
    color: colors.foreground,
    textDecoration: "none",
  },
  chatWorkspace: {
    paddingTop: { default: 24, "@media (max-width: 700px)": 0 },
    paddingBottom: { default: 16, "@media (max-width: 700px)": 0 },
    paddingInline: { default: 48, "@media (max-width: 700px)": 0 },
    overflow: { default: "visible", "@media (max-width: 700px)": "hidden" },
  },
  app: {
    position: { default: "relative", "@media (max-width: 700px)": "fixed" },
    top: {
      default: "auto",
      "@media (max-width: 700px)": "var(--roost-viewport-top, 0px)",
    },
    width: "100%",
    display: "flex",
    minHeight: { default: "100svh", "@media (max-width: 700px)": 0 },
    height: {
      default: "auto",
      "@media (max-width: 700px)": "var(--roost-viewport-height, 100dvh)",
      // iOS standalone dynamic units can omit the screen's safe areas.
      "@media (max-width: 700px) and (display-mode: standalone)":
        "var(--roost-viewport-height, 100vh)",
    },
    overflow: { default: "visible", "@media (max-width: 700px)": "hidden" },
    flexDirection: { default: "row", "@media (max-width: 700px)": "column" },
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 13,
    lineHeight: 1.5,
    WebkitFontSmoothing: "antialiased",
  },
  workspace: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: { default: "visible", "@media (max-width: 700px)": "auto" },
    paddingTop: { default: 24, "@media (max-width: 700px)": 16 },
    paddingBottom: { default: 48, "@media (max-width: 700px)": 16 },
    paddingInline: { default: 48, "@media (max-width: 700px)": 16 },
  },
});
