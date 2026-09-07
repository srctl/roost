import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useAgentActivity } from "../features/agents/activity";
import type { Agent } from "../features/agents/schema";
import { useDashboardsEnabled } from "../features/dashboards/preference";
import { colors } from "../styles/tokens.stylex";
import { AgentWorking } from "./agent-working";
import { Button } from "./ui/button";
import { Avatar, Icon } from "./ui/primitives";

export function Sidebar({
  agents,
  onCollapse,
  onNavigate,
  drawer = false,
}: {
  agents: readonly Agent[];
  onCollapse: () => void;
  onNavigate?: () => void;
  drawer?: boolean;
}) {
  const activity = useAgentActivity();
  const dashboardsEnabled = useDashboardsEnabled();

  return (
    <aside
      id={drawer ? "mobile-agent-sidebar" : "agent-sidebar"}
      {...stylex.props(styles.sidebar, drawer && styles.drawer)}
      aria-label="Agents"
    >
      <div {...stylex.props(styles.brandRow)}>
        <Link onClick={onNavigate} to="/" {...stylex.props(styles.brand)}>
          roost
        </Link>
        <Button
          aria-label={drawer ? "Close navigation" : "Collapse sidebar"}
          aria-expanded={true}
          aria-controls={drawer ? "mobile-agent-sidebar" : "agent-sidebar"}
          onClick={onCollapse}
        >
          <Icon name={drawer ? "close" : "panel"} />
        </Button>
      </div>
      <div {...stylex.props(styles.heading)}>Agents</div>
      <nav {...stylex.props(styles.list)}>
        {agents.map((agent) => (
          <Link
            key={agent.id}
            onClick={onNavigate}
            to="/agents/$agentId"
            params={{ agentId: agent.id }}
            {...stylex.props(styles.row)}
            activeProps={stylex.props(styles.row, styles.active)}
          >
            <Avatar character={agent.character} size={24} />
            <span {...stylex.props(styles.name)}>{agent.name}</span>
            {activity[agent.id] && (
              <AgentWorking activity={activity[agent.id]!} />
            )}
          </Link>
        ))}
        <Link
          onClick={onNavigate}
          to="/agents/new"
          {...stylex.props(styles.row, styles.create)}
        >
          <Icon name="plus" size={14} />
          Create agent
        </Link>
      </nav>
      <footer {...stylex.props(styles.footer)}>
        {dashboardsEnabled && (
          <Link
            onClick={onNavigate}
            to="/dashboard"
            {...stylex.props(styles.row, styles.create)}
          >
            Dashboard
          </Link>
        )}
        <Link
          onClick={onNavigate}
          to="/settings"
          {...stylex.props(styles.row, styles.create)}
        >
          Settings
        </Link>
      </footer>
    </aside>
  );
}

const styles = stylex.create({
  sidebar: {
    width: 216,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: colors.sidebar,
    padding: 20,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.border,
  },
  drawer: {
    width: "100%",
    height: "100%",
    paddingTop: "max(12px, env(safe-area-inset-top))",
    paddingBottom: "max(16px, env(safe-area-inset-bottom))",
    paddingInline: 16,
    borderRightWidth: 0,
  },
  brandRow: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: { default: 30, "@media (max-width: 700px)": 20 },
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: "-0.7px",
    textDecoration: "none",
    color: colors.foreground,
  },
  heading: {
    flexShrink: 0,
    color: colors.muted,
    fontSize: 11,
    marginBottom: 8,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollbarWidth: "thin",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: { default: 6, "@media (max-width: 700px)": 10 },
    paddingInline: 8,
    borderRadius: 6,
    textDecoration: "none",
    color: colors.foreground,
  },
  name: { overflowWrap: "anywhere" },
  active: { backgroundColor: colors.selected },
  create: { color: colors.muted, fontSize: 12 },
  footer: {
    flexShrink: 0,
    marginTop: "auto",
    paddingTop: 32,
    fontSize: 11,
    color: colors.muted,
    display: "block",
  },
});
