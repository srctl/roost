import * as stylex from "@stylexjs/stylex";
import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useAgentActivity } from "../features/agents/activity";
import { saveAgentNavigation } from "../features/agents/navigation-functions";
import type { NavigationChange } from "../features/agents/navigation-schema";
import type { Agent } from "../features/agents/schema";
import { Route } from "../routes/__root";
import { motion } from "../styles/motion.stylex";
import { colors } from "../styles/tokens.stylex";
import { AgentSectionControls } from "./agent-section-controls";
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
  const router = useRouter();
  const result = Route.useLoaderData().navigation;
  const navigation = result.ok
    ? result.value
    : { sections: [], memberships: {} };
  const [managing, setManaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(change: NavigationChange) {
    setBusy(true);
    setError("");
    try {
      const response = await saveAgentNavigation({ data: change });
      if (!response.ok) throw new Error(response.error);
      await router.invalidate();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not save sections. Try again.";
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }
  const groups = [
    ...navigation.sections,
    { id: "", name: "Ungrouped", collapsed: false },
  ];

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
        <Button aria-expanded={managing} onClick={() => setManaging(!managing)}>
          {managing ? "Done managing sections" : "Manage sections"}
        </Button>
        {(!result.ok || error) && (
          <p role="alert">{error || (!result.ok ? result.error : "")}</p>
        )}
        {managing && (
          <AgentSectionControls
            navigation={navigation}
            agents={agents}
            save={save}
            busy={busy}
          />
        )}
        {groups.map((group) => (
          <div key={group.id}>
            {group.id ? (
              <Button
                disabled={busy}
                aria-expanded={!group.collapsed}
                aria-controls={`${drawer ? "mobile" : "desktop"}-section-${group.id}`}
                onClick={() =>
                  void save({
                    action: "collapse",
                    id: group.id,
                    collapsed: !group.collapsed,
                  }).catch(() => {})
                }
                xstyle={styles.sectionHeading}
              >
                <Icon
                  name={group.collapsed ? "chevron-right" : "chevron-down"}
                  size={14}
                />
                <span {...stylex.props(styles.name)}>{group.name}</span>
              </Button>
            ) : (
              navigation.sections.length > 0 && (
                <div {...stylex.props(styles.heading)}>Ungrouped</div>
              )
            )}
            <div
              id={`${drawer ? "mobile" : "desktop"}-section-${group.id}`}
              hidden={group.collapsed}
            >
              {agents
                .filter(
                  (agent) =>
                    (navigation.memberships[agent.id] ?? "") === group.id,
                )
                .map((agent) => (
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
            </div>
          </div>
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
  sectionHeading: {
    display: "flex",
    gap: 6,
    width: "100%",
    minWidth: 0,
    textAlign: "left",
    marginTop: 8,
  },
  sidebar: {
    width: "min(var(--sidebar-width, 216px), max(140px, calc(100vw - 480px)))",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: colors.sidebar,
    paddingBlock: 20,
    paddingInline: 12,
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
    backgroundColor: {
      default: "transparent",
      "@media (hover: hover)": {
        ":hover": `color-mix(in srgb, ${colors.selected} 55%, transparent)`,
      },
    },
    transitionProperty: "background-color, color",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
  },
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  active: { backgroundColor: colors.selected },
  create: {
    color: {
      default: colors.muted,
      "@media (hover: hover)": { ":hover": colors.foreground },
    },
    fontSize: 12,
  },
  footer: {
    flexShrink: 0,
    marginTop: "auto",
    paddingTop: 32,
    fontSize: 11,
    color: colors.muted,
    display: "block",
  },
});
