import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { type DragEvent, useState } from "react";
import { useAgentActivity } from "../features/agents/activity";
import { useAgentNavigation } from "../features/agents/navigation";
import {
  orderAgents,
  orderedSections,
} from "../features/agents/navigation-state";
import type { Agent } from "../features/agents/schema";
import { Route } from "../routes/__root";
import { motion } from "../styles/motion.stylex";
import { colors } from "../styles/tokens.stylex";
import { AgentSectionControls } from "./agent-section-controls";
import { AgentWorking } from "./agent-working";
import { Button } from "./ui/button";
import { Avatar, Icon } from "./ui/primitives";

type DropTarget = {
  sectionId: string;
  beforeAgentId: string | null;
  marker: { id: string; edge: "before" | "after" } | null;
};

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
  const result = Route.useLoaderData().navigation;
  const { navigation, save, busy, error } = useAgentNavigation();
  const [managing, setManaging] = useState(false);
  const [draggedAgent, setDraggedAgent] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const orderedAgents = orderAgents(agents, navigation.agentOrder);
  const [announcement, setAnnouncement] = useState("");

  function endDrag() {
    setDraggedAgent(null);
    setDropTarget(null);
  }

  function resolveDrop(
    event: DragEvent<HTMLElement>,
    sectionId: string,
  ): DropTarget | null {
    if (!draggedAgent || !agents.some((agent) => agent.id === draggedAgent))
      return null;
    const members = orderedAgents.filter(
      (agent) => (navigation.memberships[agent.id] ?? "") === sectionId,
    );
    const remaining = members.filter((agent) => agent.id !== draggedAgent);
    const row =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-agent-id]")
        : null;
    let beforeAgentId: string | null = null;
    let marker: DropTarget["marker"] = null;
    if (row && event.currentTarget.contains(row)) {
      const id = row.dataset.agentId!;
      if (id === draggedAgent) return null;
      const index = remaining.findIndex((agent) => agent.id === id);
      if (index < 0) return null;
      const bounds = row.getBoundingClientRect();
      const after = event.clientY >= bounds.top + bounds.height / 2;
      beforeAgentId = after ? (remaining[index + 1]?.id ?? null) : id;
      marker = { id, edge: after ? "after" : "before" };
    }
    if ((navigation.memberships[draggedAgent] ?? "") === sectionId) {
      const next = remaining.map((agent) => agent.id);
      next.splice(
        beforeAgentId === null ? next.length : next.indexOf(beforeAgentId),
        0,
        draggedAgent,
      );
      if (next.every((id, index) => members[index]?.id === id)) return null;
    }
    return { sectionId, beforeAgentId, marker };
  }

  function dragOver(event: DragEvent<HTMLElement>, sectionId: string) {
    const target = resolveDrop(event, sectionId);
    setDropTarget(target);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function moveAgent(
    agentId: string,
    sectionId: string,
    beforeAgentId: string | null,
  ) {
    const name = agents.find((agent) => agent.id === agentId)!.name;
    const sectionName =
      navigation.sections.find((section) => section.id === sectionId)?.name ??
      "Ungrouped";
    setAnnouncement(`Moving ${name} in ${sectionName}.`);
    void save({
      action: "move",
      agentId,
      sectionId: sectionId || null,
      beforeAgentId,
    })
      .then(() => setAnnouncement(`Moved ${name} in ${sectionName}.`))
      .catch(() =>
        setAnnouncement(`Could not save the move for ${name}. Try again.`),
      );
  }

  function drop(event: DragEvent<HTMLElement>, sectionId: string) {
    event.preventDefault();
    const target = resolveDrop(event, sectionId);
    if (target && draggedAgent)
      moveAgent(draggedAgent, sectionId, target.beforeAgentId);
    endDrag();
  }

  const groups = orderedSections(navigation);

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
      <div {...stylex.props(styles.heading)}>
        <span>Agents</span>
        <Button
          aria-label="Manage sections"
          title="Manage sections"
          aria-haspopup="dialog"
          onClick={() => setManaging(true)}
          xstyle={styles.manage}
        >
          <Icon name="settings" size={14} />
        </Button>
      </div>
      {managing && (
        <AgentSectionControls
          navigation={navigation}
          agents={agents}
          save={save}
          busy={busy}
          error={error}
          onClose={() => setManaging(false)}
        />
      )}
      <span role="status" {...stylex.props(styles.srOnly)}>
        {announcement}
      </span>
      <nav {...stylex.props(styles.list)}>
        {(!result.ok || error) && (
          <p role="alert" {...stylex.props(styles.error)}>
            {error || (!result.ok ? result.error : "")}
          </p>
        )}
        {groups.map((group, index) => (
          <section
            key={group.id}
            aria-label={`${group.name} agents`}
            data-agent-section={group.id || "ungrouped"}
            onDragEnter={(event) => dragOver(event, group.id)}
            onDragOver={(event) => dragOver(event, group.id)}
            onDragLeave={(event) => {
              if (
                !(
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                )
              ) {
                setDropTarget((current) =>
                  current?.sectionId === group.id ? null : current,
                );
              }
            }}
            onDrop={(event) => drop(event, group.id)}
            {...stylex.props(
              styles.group,
              dropTarget?.sectionId === group.id &&
                !dropTarget.marker &&
                styles.dropTarget,
              !group.id &&
                index > 0 &&
                navigation.sections.length > 0 &&
                styles.ungrouped,
            )}
          >
            {group.id && (
              <Button
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
                {group.collapsed && (
                  <span {...stylex.props(styles.count)}>
                    {
                      agents.filter(
                        (agent) =>
                          navigation.memberships[agent.id] === group.id,
                      ).length
                    }
                  </span>
                )}
              </Button>
            )}
            {!group.id &&
              navigation.sections.length > 0 &&
              (draggedAgent !== null ||
                agents.some((agent) => !navigation.memberships[agent.id])) && (
                <div {...stylex.props(styles.ungroupedHeading)}>Ungrouped</div>
              )}
            <div
              {...stylex.props(!!group.id && styles.sectionMembers)}
              id={`${drawer ? "mobile" : "desktop"}-section-${group.id}`}
              hidden={group.collapsed}
            >
              {orderedAgents
                .filter(
                  (agent) =>
                    (navigation.memberships[agent.id] ?? "") === group.id,
                )
                .map((agent) => (
                  <Link
                    key={agent.id}
                    draggable
                    data-agent-id={agent.id}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                    title="Drag to reorder, or use Alt + ↑ / ↓"
                    onKeyDown={(event) => {
                      if (
                        !event.altKey ||
                        !["ArrowUp", "ArrowDown"].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      const members = orderedAgents.filter(
                        (member) =>
                          (navigation.memberships[member.id] ?? "") ===
                          group.id,
                      );
                      const index = members.findIndex(
                        (member) => member.id === agent.id,
                      );
                      if (event.key === "ArrowUp" && index > 0)
                        moveAgent(agent.id, group.id, members[index - 1]!.id);
                      if (
                        event.key === "ArrowDown" &&
                        index < members.length - 1
                      )
                        moveAgent(
                          agent.id,
                          group.id,
                          members[index + 2]?.id ?? null,
                        );
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.clearData();
                      event.dataTransfer.setData(
                        "application/x-roost-agent",
                        agent.id,
                      );
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setDragImage(
                        event.currentTarget,
                        16,
                        18,
                      );
                      setDraggedAgent(agent.id);
                      setAnnouncement("");
                    }}
                    onDragEnd={endDrag}
                    onClick={onNavigate}
                    to="/agents/$agentId"
                    params={{ agentId: agent.id }}
                    {...stylex.props(
                      styles.row,
                      draggedAgent === agent.id && styles.dragged,
                      dropTarget?.marker?.id === agent.id &&
                        (dropTarget.marker.edge === "before"
                          ? styles.insertBefore
                          : styles.insertAfter),
                    )}
                    activeProps={stylex.props(
                      styles.row,
                      styles.active,
                      draggedAgent === agent.id && styles.dragged,
                      dropTarget?.marker?.id === agent.id &&
                        (dropTarget.marker.edge === "before"
                          ? styles.insertBefore
                          : styles.insertAfter),
                    )}
                  >
                    <Avatar character={agent.character} size={24} />
                    <span {...stylex.props(styles.name)}>{agent.name}</span>
                    {activity[agent.id] && (
                      <AgentWorking activity={activity[agent.id]!} />
                    )}
                  </Link>
                ))}
            </div>
          </section>
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
  group: {
    borderRadius: 6,
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
  },
  dropTarget: {
    backgroundColor: colors.selected,
  },
  dragged: { opacity: 0.45 },
  insertBefore: {
    borderRadius: 0,
    boxShadow: `inset 0 2px 0 ${colors.accent}`,
  },
  insertAfter: {
    borderRadius: 0,
    boxShadow: `inset 0 -2px 0 ${colors.accent}`,
  },
  count: {
    fontSize: 11,
    color: colors.muted,
    fontVariantNumeric: "tabular-nums",
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
    borderWidth: 0,
  },
  sectionHeading: {
    display: "flex",
    gap: 6,
    width: "100%",
    minWidth: 0,
    textAlign: "left",
    justifyContent: "flex-start",
    fontSize: 12,
    paddingInline: 6,
    transform: "none",
  },
  manage: { padding: 6 },
  error: { fontSize: 12, color: colors.muted, margin: 0, padding: 8 },
  sectionMembers: {
    marginLeft: 12,
    paddingLeft: 6,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
  },
  ungrouped: { marginTop: 12 },
  ungroupedHeading: {
    fontSize: 11,
    color: colors.muted,
    paddingInline: 8,
    paddingBottom: 4,
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
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
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
