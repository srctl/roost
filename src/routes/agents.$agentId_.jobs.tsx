import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AgentHeader } from "../components/agent-header";
import { Button } from "../components/ui/button";
import type { Agent } from "../features/agents/schema";
import { getCodingJobs, stopCodingJob } from "../features/coding/functions";
import type { CodingJob, CodingJobStatus } from "../features/coding/schema";
import { colors } from "../styles/tokens.stylex";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/agents/$agentId_/jobs")({
  loader: ({ params }) => loadJobs(params.agentId),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: JobsPage,
});

function loadJobs(agentId: string) {
  return getCodingJobs({ data: { agentId } }).catch(() => ({
    ok: false as const,
    error: "Could not access these jobs. Check Roost and try again.",
  }));
}

const statusLabels: Record<CodingJobStatus, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  blocked: "Needs attention",
  review: "Ready for review",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function isActive(status: CodingJobStatus) {
  return ["queued", "starting", "running", "blocked"].includes(status);
}

function canStop(status: CodingJobStatus) {
  return !["completed", "cancelled", "failed"].includes(status);
}

function JobsPage() {
  const { agentId } = Route.useParams();
  const loaded = Route.useLoaderData();
  const agents = RootRoute.useLoaderData();
  const agent = agents.ok
    ? agents.value.find((item) => item.id === agentId)
    : undefined;
  if (!agent) return <p>Agent not found.</p>;
  return <AgentJobs key={agentId} agent={agent} loaded={loaded} />;
}

function AgentJobs({
  agent,
  loaded,
}: {
  agent: Agent;
  loaded: Awaited<ReturnType<typeof loadJobs>>;
}) {
  const router = useRouter();
  const result = loaded;
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const active =
    result.ok &&
    result.value.some(
      (job) =>
        isActive(job.status) || (job.cancelRequested && canStop(job.status)),
    );

  useEffect(() => {
    if (agent.kind !== "coding") return;
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        await router.invalidate({
          filter: (match) =>
            match.routeId === Route.id && match.params.agentId === agent.id,
          sync: true,
        });
      } catch {
        if (mounted) setError("Could not refresh jobs. Try again.");
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void refresh(), active ? 4000 : 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, agent.id, agent.kind, active]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      await router.invalidate({
        filter: (match) =>
          match.routeId === Route.id && match.params.agentId === agent.id,
        sync: true,
      });
    } catch {
      setError("Could not refresh jobs. Try again.");
    } finally {
      setRefreshing(false);
    }
  }

  async function stop(id: string) {
    if (stopping) return;
    setStopping(id);
    setError("");
    try {
      const stopped = await stopCodingJob({ data: { agentId: agent.id, id } });
      if (!stopped.ok) {
        setError(stopped.error);
        return;
      }
      await refresh();
    } catch {
      setError("Could not stop this job. Refresh its progress and try again.");
    } finally {
      setStopping(undefined);
    }
  }

  return (
    <section {...stylex.props(styles.page)}>
      <AgentHeader agent={agent} />
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.headingRow)}>
          <div>
            <h2 {...stylex.props(styles.title)}>Jobs</h2>
            <p {...stylex.props(styles.help)}>
              Assign work and discuss results in {agent.name}’s conversation.
            </p>
          </div>
          {agent.kind === "coding" && (
            <Button disabled={refreshing} onClick={() => void refresh()}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" {...stylex.props(styles.error)}>
            {error}
          </p>
        )}
        {agent.kind !== "coding" ? (
          <p {...stylex.props(styles.help)}>
            Jobs are available for coding agents. Create a coding agent to
            manage development work for a project.
          </p>
        ) : !result.ok ? (
          <div role="alert">
            <p>{result.error}</p>
            <Button disabled={refreshing} onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : result.value.length === 0 ? (
          <div {...stylex.props(styles.empty)}>
            <h3 {...stylex.props(styles.emptyTitle)}>No jobs yet</h3>
            <p {...stylex.props(styles.help)}>
              Give {agent.name} a coding task or a Notion ticket, and say where
              you want the work to run. Configure project defaults and execution
              profiles in this agent’s settings.
            </p>
            <Link
              to="/agents/$agentId"
              params={{ agentId: agent.id }}
              {...stylex.props(styles.link)}
            >
              Start in conversation →
            </Link>
          </div>
        ) : (
          <ul {...stylex.props(styles.list)}>
            {result.value.map((job) => (
              <li key={job.id} {...stylex.props(styles.item)}>
                <details>
                  <summary {...stylex.props(styles.jobHeading)}>
                    <span {...stylex.props(styles.jobTitle)}>{job.title}</span>
                    <span
                      {...stylex.props(
                        styles.status,
                        ["blocked", "failed"].includes(job.status) &&
                          styles.attention,
                      )}
                    >
                      {job.cancelRequested && canStop(job.status)
                        ? "Stopping…"
                        : statusLabels[job.status]}
                    </span>
                    <time
                      dateTime={new Date(job.updatedAt).toISOString()}
                      title={new Date(job.updatedAt).toLocaleString()}
                      {...stylex.props(styles.date)}
                    >
                      {new Date(job.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </summary>
                  <JobDetails job={job} />
                  {canStop(job.status) && (
                    <Button
                      disabled={Boolean(stopping) || job.cancelRequested}
                      aria-label={`Stop ${job.title}`}
                      onClick={() => void stop(job.id)}
                      xstyle={styles.stop}
                    >
                      {stopping === job.id || job.cancelRequested
                        ? "Stopping…"
                        : "Stop job"}
                    </Button>
                  )}
                </details>
                {job.summary && (
                  <p {...stylex.props(styles.summary)}>{job.summary}</p>
                )}
                {job.error && (
                  <p {...stylex.props(styles.error)}>{job.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function JobDetails({ job }: { job: CodingJob }) {
  const source = /^https?:\/\//i.test(job.sourceUrl)
    ? job.sourceUrl
    : undefined;
  return (
    <div {...stylex.props(styles.details)}>
      <p {...stylex.props(styles.brief)}>{job.assignment || job.brief}</p>
      {source && (
        <a
          href={source}
          target="_blank"
          rel="noreferrer"
          {...stylex.props(styles.link)}
        >
          Open task source ↗
        </a>
      )}
      <dl {...stylex.props(styles.metadata)}>
        <dt>Machine</dt>
        <dd {...stylex.props(styles.value)}>
          {job.remoteTarget || "Roost host"}
        </dd>
        {job.cwd && (
          <>
            <dt>Workspace</dt>
            <dd {...stylex.props(styles.value)}>{job.cwd}</dd>
          </>
        )}
        {job.sessionName && (
          <>
            <dt>Herdr session</dt>
            <dd {...stylex.props(styles.value)}>{job.sessionName}</dd>
          </>
        )}
        {job.workerName && (
          <>
            <dt>Worker</dt>
            <dd {...stylex.props(styles.value)}>
              {job.workerName}
              {job.workerKind ? ` · ${job.workerKind}` : ""}
            </dd>
          </>
        )}
        <dt>Updated</dt>
        <dd {...stylex.props(styles.value)}>
          {new Date(job.updatedAt).toLocaleString()}
        </dd>
      </dl>
      {job.output && (
        <details>
          <summary {...stylex.props(styles.outputLabel)}>Worker output</summary>
          <pre {...stylex.props(styles.output)}>{job.output}</pre>
        </details>
      )}
    </div>
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
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    padding: { default: 28, "@media (max-width: 700px)": 16 },
  },
  headingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "start",
    gap: 16,
    marginBottom: 24,
  },
  title: { fontSize: 18, fontWeight: 500, margin: 0 },
  help: { color: colors.muted, fontSize: 13, lineHeight: 1.7, marginBlock: 8 },
  empty: { maxWidth: 420, marginInline: "auto", paddingBlock: 64 },
  emptyTitle: { fontSize: 16, fontWeight: 500, margin: 0 },
  list: { listStyle: "none", padding: 0, margin: 0 },
  item: {
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
    paddingBlock: 16,
  },
  jobHeading: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr) auto 60px",
      "@media (max-width: 700px)": "minmax(0, 1fr) auto",
    },
    alignItems: "baseline",
    gap: { default: 20, "@media (max-width: 700px)": 8 },
    paddingBlock: 4,
    cursor: "pointer",
    outlineOffset: 4,
  },
  jobTitle: { fontSize: 14, fontWeight: 500, overflowWrap: "anywhere" },
  status: { fontSize: 12, color: colors.muted, whiteSpace: "nowrap" },
  attention: { color: colors.review },
  date: {
    display: { default: "block", "@media (max-width: 700px)": "none" },
    fontSize: 12,
    color: colors.muted,
    textAlign: "right",
  },
  details: { paddingBlock: 8, maxWidth: 760 },
  brief: {
    fontSize: 13,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    marginBlock: 8,
  },
  metadata: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: "6px 16px",
    fontSize: 12,
    color: colors.muted,
    marginBlock: 16,
  },
  value: { margin: 0, overflowWrap: "anywhere", color: colors.foreground },
  outputLabel: {
    cursor: "pointer",
    fontSize: 12,
    color: colors.muted,
    paddingBlock: 8,
  },
  output: {
    maxHeight: 320,
    overflowY: "auto",
    overscrollBehavior: "contain",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 1.6,
    marginBlock: 8,
  },
  summary: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontSize: 13,
    lineHeight: 1.7,
    marginBlock: 8,
    color: colors.muted,
  },
  error: {
    color: colors.review,
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
    fontSize: 13,
  },
  stop: { marginBottom: 8 },
  link: { color: colors.foreground, fontSize: 12, textUnderlineOffset: 3 },
});
