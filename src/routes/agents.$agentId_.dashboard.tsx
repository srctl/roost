import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardWidget } from "../components/dashboard-widget";
import { Button } from "../components/ui/button";
import type { Agent } from "../features/agents/schema";
import { getDashboard } from "../features/dashboards/functions";
import { updateDashboardPreference } from "../features/dashboards/preference";
import { colors } from "../styles/tokens.stylex";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/agents/$agentId_/dashboard")({
  loader: ({ params }) => loadDashboard(params.agentId),
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
  return (
    <section {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div>
          <Link
            to="/agents/$agentId"
            params={{ agentId }}
            {...stylex.props(styles.link)}
          >
            ← {agent.name}
          </Link>
          <h1 {...stylex.props(styles.title)}>Dashboard</h1>
          <p {...stylex.props(styles.description)}>
            The things you’re keeping an eye on with {agent.name}.
          </p>
        </div>
      </header>
      <AgentDashboard key={agentId} agent={agent} loaded={loaded} />
    </section>
  );
}

function AgentDashboard({
  agent,
  loaded,
}: {
  agent: Agent;
  loaded: Awaited<ReturnType<typeof loadDashboard>>;
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
      {widgets.length ? (
        <div {...stylex.props(styles.grid)}>
          {widgets.map((widget) => (
            <DashboardWidget
              key={`${widget.agentId}:${widget.key}`}
              widget={widget}
              agentName={agent.name}
            />
          ))}
        </div>
      ) : (
        <div {...stylex.props(styles.empty)}>
          <h2 {...stylex.props(styles.emptyTitle)}>
            Choose what you want to track.
          </h2>
          <p {...stylex.props(styles.emptyText)}>
            Ask {agent.name} to build a tracker with you. Mix notes, tasks,
            metrics, tables, charts, and source links. Ask for an automation
            when it should update on a schedule.
          </p>
          <p {...stylex.props(styles.example)}>
            “Make a dashboard for my project: next steps, current status, and
            the metrics that matter.”
          </p>
          <div {...stylex.props(styles.agents)}>
            <Link
              to="/agents/$agentId"
              params={{ agentId: agent.id }}
              {...stylex.props(styles.link)}
            >
              Talk to {agent.name} ↗
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

const styles = stylex.create({
  page: {
    maxWidth: 1100,
    marginInline: "auto",
    paddingBlock: { default: 24, "@media (max-width: 700px)": 8 },
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 28,
  },
  title: { margin: 0, fontSize: 26, fontWeight: 500, letterSpacing: "-0.6px" },
  description: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 8,
    lineHeight: 1.65,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 950px)": "minmax(0, 1fr)",
    },
    gap: 20,
    alignItems: "start",
  },
  empty: { maxWidth: 500, marginInline: "auto", paddingBlock: 70 },
  emptyTitle: { fontSize: 20, fontWeight: 500, margin: 0 },
  emptyText: { color: colors.muted, lineHeight: 1.8, fontSize: 13 },
  example: {
    fontSize: 14,
    lineHeight: 1.8,
    paddingBlock: 18,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopStyle: "solid",
    borderBottomStyle: "solid",
    borderTopColor: colors.border,
    borderBottomColor: colors.border,
  },
  agents: { display: "flex", flexWrap: "wrap", gap: 16, marginTop: 24 },
  link: { color: colors.foreground, textUnderlineOffset: 3, fontSize: 12 },
});
