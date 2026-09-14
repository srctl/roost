import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AgentHeader } from "../components/agent-header";
import { Conversation } from "../components/conversation";
import { DashboardDataSources } from "../components/dashboard-data";
import { DashboardWidget } from "../components/dashboard-widget";
import { Button } from "../components/ui/button";
import type { Agent } from "../features/agents/schema";
import { getConversationSnapshot } from "../features/chat/functions";
import { getDashboard } from "../features/dashboards/functions";
import { updateDashboardPreference } from "../features/dashboards/preference";
import { colors } from "../styles/tokens.stylex";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/agents/$agentId_/dashboard")({
  loader: async ({ params }) => {
    const [dashboard, conversation] = await Promise.all([
      loadDashboard(params.agentId),
      getConversationSnapshot({ data: { agentId: params.agentId } }).catch(
        () => ({
          ok: false as const,
          error: "Could not access this conversation. Check Roost and retry.",
        }),
      ),
    ]);
    return { dashboard, conversation };
  },
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: DashboardPage,
});

function loadDashboard(agentId: string) {
  return getDashboard({ data: { agentId } }).catch(() => ({
    ok: false as const,
    error: "Could not access this dashboard. Check Roost and try again.",
  }));
}

function DashboardPage() {
  const { agentId } = Route.useParams();
  const loaded = Route.useLoaderData();
  const agents = RootRoute.useLoaderData();
  const agent = agents.ok
    ? agents.value.find((agent) => agent.id === agentId)
    : undefined;
  if (!agent) return <p>Agent not found.</p>;
  return <DashboardWorkspace key={agentId} agent={agent} loaded={loaded} />;
}

function DashboardWorkspace({
  agent,
  loaded,
}: {
  agent: Agent;
  loaded: ReturnType<typeof Route.useLoaderData>;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatWidth, setChatWidth] = useState(360);
  const workspace = useRef<HTMLDivElement>(null);
  const [maxChatWidth, setMaxChatWidth] = useState(600);
  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const maximum = Math.max(300, Math.min(600, element.clientWidth - 360));
      setMaxChatWidth(maximum);
      setChatWidth((width) => Math.min(width, maximum));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function resizeChat(width: number) {
    setChatWidth(Math.round(Math.max(300, Math.min(maxChatWidth, width))));
  }
  const chat = useRef<HTMLElement>(null);
  const chatButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (chatOpen) chat.current?.querySelector("textarea")?.focus();
  }, [chatOpen, chatCollapsed]);
  return (
    <section
      {...stylex.props(styles.page)}
      style={
        {
          "--dashboard-chat-width": `${chatWidth}px`,
          "--dashboard-chat-display": chatCollapsed ? "none" : "block",
        } as CSSProperties
      }
    >
      <AgentHeader agent={agent} dashboard>
        <Button
          onClick={() => setChatCollapsed(!chatCollapsed)}
          aria-expanded={!chatCollapsed}
          aria-controls="dashboard-chat"
          xstyle={styles.desktopChatToggle}
        >
          {chatCollapsed ? "Show chat" : "Hide chat"}
        </Button>
        <Button
          ref={chatButton}
          onClick={() => setChatOpen(!chatOpen)}
          aria-expanded={chatOpen}
          aria-controls="dashboard-chat"
          xstyle={styles.chatToggle}
        >
          Chat
        </Button>
      </AgentHeader>
      <div
        ref={workspace}
        {...stylex.props(
          styles.workspace,
          chatCollapsed && styles.workspaceCollapsed,
        )}
      >
        <section
          aria-label="Dashboard widgets"
          {...stylex.props(styles.content, chatOpen && styles.contentHidden)}
        >
          <AgentDashboard
            agent={agent}
            loaded={loaded.dashboard}
            onDiscuss={() => {
              setChatCollapsed(false);
              setChatOpen(true);
              chat.current?.querySelector("textarea")?.focus();
            }}
          />
        </section>
        {!chatCollapsed && (
          // biome-ignore lint/a11y/useSemanticElements: This is an interactive pane splitter, not a thematic break.
          <div
            role="separator"
            tabIndex={0}
            aria-label="Resize chat"
            aria-orientation="vertical"
            aria-controls="dashboard-chat"
            aria-valuemin={300}
            aria-valuemax={maxChatWidth}
            aria-valuenow={chatWidth}
            {...stylex.props(styles.resizeHandle)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (
                !event.currentTarget.hasPointerCapture(event.pointerId) ||
                !workspace.current
              )
                return;
              resizeChat(
                workspace.current.getBoundingClientRect().right - event.clientX,
              );
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              if (event.key === "Home") resizeChat(300);
              else if (event.key === "End") resizeChat(maxChatWidth);
              else
                resizeChat(chatWidth + (event.key === "ArrowLeft" ? 24 : -24));
            }}
          >
            <span {...stylex.props(styles.resizeLine)} />
          </div>
        )}
        <aside
          id="dashboard-chat"
          ref={chat}
          aria-label={`Chat with ${agent.name}`}
          {...stylex.props(styles.chat, chatOpen && styles.chatOpen)}
        >
          <Conversation
            agent={agent}
            initialConversation={loaded.conversation}
            embedded
            onClose={() => {
              setChatOpen(false);
              chatButton.current?.focus();
            }}
          />
        </aside>
      </div>
    </section>
  );
}

function AgentDashboard({
  agent,
  loaded,
  onDiscuss,
}: {
  agent: Agent;
  loaded: Awaited<ReturnType<typeof loadDashboard>>;
  onDiscuss: () => void;
}) {
  const [result, setResult] = useState(loaded);
  const [refreshError, setRefreshError] = useState(false);
  useEffect(() => {
    setResult(loaded);
  }, [loaded]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const next = await loadDashboard(agent.id);
      if (!active) return;
      if (next.ok) {
        setResult(next);
        setRefreshError(false);
      } else setRefreshError(true);
    };
    const timer = setInterval(() => void refresh(), 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [agent.id]);
  useEffect(() => {
    if (result.ok) updateDashboardPreference(result.value.enabled);
  }, [result]);
  if (!result.ok)
    return (
      <div>
        <p role="alert">{result.error}</p>
        <Button onClick={() => void loadDashboard(agent.id).then(setResult)}>
          Try again
        </Button>
      </div>
    );
  if (!result.value.enabled)
    return (
      <div>
        <h2 {...stylex.props(styles.emptyTitle)}>Dashboards are off</h2>
        <p {...stylex.props(styles.description)}>
          Enable dashboards in Settings to keep trackers, projects, and trends
          here. Your saved content stays when dashboards are off.
        </p>
        <Link to="/settings" {...stylex.props(styles.link)}>
          Open Settings
        </Link>
      </div>
    );
  const widgets = result.value.widgets;
  return (
    <>
      {refreshError && (
        <p role="status" {...stylex.props(styles.description)}>
          Could not refresh. Showing the last loaded dashboard.
        </p>
      )}
      <DashboardDataSources datasets={result.value.datasets} />
      {widgets.length ? (
        <div {...stylex.props(styles.grid)}>
          {widgets.map((widget) => (
            <DashboardWidget
              key={`${widget.agentId}:${widget.key}`}
              widget={widget}
              datasets={result.value.datasets}
              agentName={agent.name}
              onDiscuss={onDiscuss}
            />
          ))}
        </div>
      ) : (
        <div {...stylex.props(styles.empty)}>
          <h2 {...stylex.props(styles.emptyTitle)}>No widgets yet</h2>
          <p {...stylex.props(styles.emptyText)}>
            Ask {agent.name} to create a tracker in the conversation. Notes,
            tasks, and charts saved by your agent will appear here.
          </p>
          <Button onClick={onDiscuss}>Start a tracker →</Button>
        </div>
      )}
    </>
  );
}

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: {
      default: "calc(100svh - 40px)",
      "@media (max-width: 700px)": "100%",
    },
    minHeight: 0,
  },
  workspace: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) 9px var(--dashboard-chat-width)",
      "@media (max-width: 1100px)": "minmax(0, 1fr)",
    },
    flex: 1,
    minHeight: 0,
  },
  workspaceCollapsed: { gridTemplateColumns: "minmax(0, 1fr)" },
  desktopChatToggle: {
    display: { default: "inline-flex", "@media (max-width: 1100px)": "none" },
  },
  resizeHandle: {
    display: { default: "flex", "@media (max-width: 1100px)": "none" },
    alignItems: "stretch",
    justifyContent: "center",
    cursor: "col-resize",
    touchAction: "none",
    outlineOffset: -2,
    color: {
      default: colors.border,
      ":hover": colors.muted,
      ":focus-visible": colors.accent,
    },
  },
  resizeLine: {
    width: 1,
    backgroundColor: "currentColor",
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  },
  content: {
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: { default: 28, "@media (max-width: 700px)": 16 },
  },
  contentHidden: {
    display: { default: "block", "@media (max-width: 1100px)": "none" },
  },
  chat: {
    display: {
      default: "var(--dashboard-chat-display)",
      "@media (max-width: 1100px)": "none",
    },
    minWidth: 0,
    minHeight: 0,
    paddingLeft: { default: 20, "@media (max-width: 1100px)": 12 },
    paddingRight: { default: 0, "@media (max-width: 1100px)": 12 },
  },
  chatOpen: {
    display: {
      default: "var(--dashboard-chat-display)",
      "@media (max-width: 1100px)": "block",
    },
  },
  chatToggle: {
    display: { default: "none", "@media (max-width: 1100px)": "inline-flex" },
  },
  description: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 8,
    lineHeight: 1.65,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
    gap: 20,
    alignItems: "start",
  },
  empty: { maxWidth: 360, marginInline: "auto", paddingBlock: 80 },
  emptyTitle: { fontSize: 18, fontWeight: 500, margin: 0 },
  emptyText: { color: colors.muted, lineHeight: 1.8, fontSize: 13 },
  link: { color: colors.foreground, textUnderlineOffset: 3, fontSize: 12 },
});
