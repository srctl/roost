import { PreferencesProvider } from "./features/settings/preferences";
import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { Icon } from "./components/ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { MobileNavigation } from "./components/mobile-navigation";
import { Sidebar } from "./components/sidebar";
import { Route } from "./routes/__root";
import { colors } from "./styles/tokens.stylex";

export function App() {
  const [collapsed, setCollapsed] = useState(false);
  const agents = Route.useLoaderData();
  const chatting = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === "/agents/$agentId"),
  });
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () =>
      shell.current?.style.setProperty(
        "--roost-viewport-height",
        `${viewport.height}px`,
      );
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, []);
  return (
    <PreferencesProvider>
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
        {!chatting && (
          <header {...stylex.props(styles.mobileHeader)}>
            <MobileNavigation />
            <Link to="/" {...stylex.props(styles.brand)}>
              roost
            </Link>
          </header>
        )}
        <main
          {...stylex.props(styles.workspace, chatting && styles.chatWorkspace)}
        >
          {!agents.ok && <p role="alert">{agents.error}</p>}
          <Outlet />
        </main>
      </div>
    </PreferencesProvider>
  );
}
const styles = stylex.create({
  desktopNavigation: {
    display: { default: "flex", "@media (max-width: 700px)": "none" },
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
    display: "flex",
    minHeight: { default: "100svh", "@media (max-width: 700px)": 0 },
    height: {
      default: "auto",
      "@media (max-width: 700px)": "var(--roost-viewport-height, 100dvh)",
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
