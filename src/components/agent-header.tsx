import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Agent } from "../features/agents/schema";
import { useDashboardsEnabled } from "../features/dashboards/preference";
import { motion } from "../styles/motion.stylex";
import { colors } from "../styles/tokens.stylex";
import { AgentSettings } from "./agent-settings";
import { MobileNavigation } from "./mobile-navigation";
import { Avatar } from "./ui/primitives";

export function AgentHeader({
  agent,
  dashboard = false,
  children,
}: {
  agent: Agent;
  dashboard?: boolean;
  children?: ReactNode;
}) {
  const dashboardsEnabled = useDashboardsEnabled();
  return (
    <header {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.identity)}>
        <MobileNavigation />
        <Avatar character={agent.character} />
        <h1 {...stylex.props(styles.title)}>{agent.name}</h1>
      </div>
      {(dashboard || dashboardsEnabled) && (
        <nav aria-label={`${agent.name} views`} {...stylex.props(styles.tabs)}>
          <Link
            to="/agents/$agentId"
            params={{ agentId: agent.id }}
            activeOptions={{ exact: true }}
            {...stylex.props(styles.tab)}
            activeProps={stylex.props(styles.tab, styles.active)}
          >
            Conversation
          </Link>
          <Link
            to="/agents/$agentId/dashboard"
            params={{ agentId: agent.id }}
            {...stylex.props(styles.tab)}
            activeProps={stylex.props(styles.tab, styles.active)}
          >
            Dashboard
          </Link>
        </nav>
      )}
      <div {...stylex.props(styles.actions)}>
        {children}
        <AgentSettings agent={agent} />
      </div>
    </header>
  );
}

const styles = stylex.create({
  header: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, auto) 1fr auto",
      "@media (max-width: 700px)": "minmax(0, 1fr) auto",
    },
    alignItems: "center",
    columnGap: { default: 28, "@media (max-width: 700px)": 8 },
    paddingTop: {
      default: 0,
      "@media (max-width: 700px)": "env(safe-area-inset-top)",
    },
    paddingInline: { default: 0, "@media (max-width: 700px)": 8 },
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  identity: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    minWidth: 0,
    maxWidth: { default: 240, "@media (max-width: 700px)": "none" },
  },
  title: {
    margin: 0,
    minWidth: 0,
    fontSize: 16,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: {
    gridColumn: { default: "3", "@media (max-width: 700px)": "2" },
    gridRow: "1",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: 4,
    marginLeft: "auto",
  },
  tabs: {
    gridColumn: { default: "2", "@media (max-width: 700px)": "1 / -1" },
    gridRow: { default: "1", "@media (max-width: 700px)": "2" },
    display: "flex",
    alignSelf: "stretch",
    gap: 20,
    paddingInline: { default: 0, "@media (max-width: 700px)": 8 },
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: { default: 44, "@media (max-width: 700px)": 36 },
    fontSize: 12,
    color: { default: colors.muted, ":hover": colors.foreground },
    textDecoration: "none",
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    marginBottom: -1,
    outlineOffset: -2,
    transitionProperty: "color, border-color",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
  },
  active: { color: colors.foreground, borderBottomColor: colors.foreground },
});
