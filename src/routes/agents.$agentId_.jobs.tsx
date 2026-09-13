import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AgentHeader } from "../components/agent-header";
import { Conversation } from "../components/conversation";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/primitives";
import type { Agent } from "../features/agents/schema";
import {
  getCodingJobs,
  getCodingWorkspace,
  inspectWorkerFailure,
  postJobFeedback,
  postWorkerMessage,
  stopCodingJob,
  submitJobFeedback,
} from "../features/coding/functions";
import type { CodingJob } from "../features/coding/schema";
import {
  type CodingWorkspace,
  type JobFeedback,
  jobWorkflowLabel,
  previewState,
  type WorkerMessage,
} from "../features/coding/workspace-schema";
import { jobsStyles as s } from "../styles/jobs.stylex";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/agents/$agentId_/jobs")({
  validateSearch: (search: Record<string, unknown>): { job?: string } => ({
    job:
      typeof search.job === "string" && /^[\da-f-]{36}$/i.test(search.job)
        ? search.job
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ job: search.job }),
  loader: ({ params, deps }) => loadJobs(params.agentId, deps.job),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: JobsPage,
});
async function loadJobs(agentId: string, id?: string) {
  const jobs = await getCodingJobs({ data: { agentId } }).catch(() => ({
    ok: false as const,
    error: "Could not access these jobs. Check Roost and try again.",
  }));
  const detail = id
    ? await getCodingWorkspace({ data: { agentId, id } }).catch(() => ({
        ok: false as const,
        error: "Could not load this job’s discussion. Refresh and try again.",
      }))
    : undefined;
  return { jobs, detail };
}
type Job = CodingJob & { workspace: CodingWorkspace };
function active(job: CodingJob) {
  return ["queued", "starting", "running", "blocked"].includes(job.status);
}
function canStop(job: CodingJob) {
  return !["completed", "cancelled", "failed"].includes(job.status);
}
function Status({ job }: { job: Job }) {
  const label = jobWorkflowLabel(job, job.workspace);
  return (
    <span
      {...stylex.props(
        s.status,
        label === "Ready for feedback" && s.feedback,
        ["Blocked", "Failed"].includes(label) && s.blocked,
      )}
    >
      {label}
    </span>
  );
}
function Primary({ job, now }: { job: Job; now: number }) {
  const w = job.workspace;
  const review =
    (jobWorkflowLabel(job, w) === "Ready for review" ||
      job.status === "completed") &&
    w.pullRequests[0];
  if (review)
    return (
      <a
        href={review}
        target="_blank"
        rel="noreferrer"
        {...stylex.props(s.actionLink)}
      >
        {job.status === "completed" ? "View PR" : "Review PR"} ↗
      </a>
    );
  if (previewState(w, now) === "running" && w.previewUrl)
    return (
      <a
        href={w.previewUrl}
        target="_blank"
        rel="noreferrer"
        {...stylex.props(s.actionLink)}
      >
        Open preview ↗
      </a>
    );
  return (
    <span {...stylex.props(s.muted)}>
      {previewState(w, now) === "unknown"
        ? "Preview status unknown"
        : "Preview unavailable"}
    </span>
  );
}
function JobsPage() {
  const { agentId } = Route.useParams();
  const loaded = Route.useLoaderData();
  const agents = RootRoute.useLoaderData();
  const agent = agents.ok
    ? agents.value.find((item) => item.id === agentId)
    : undefined;
  return agent ? (
    <AgentJobs key={agentId} agent={agent} loaded={loaded} />
  ) : (
    <p>Agent not found.</p>
  );
}
function AgentJobs({
  agent,
  loaded,
}: {
  agent: Agent;
  loaded: Awaited<ReturnType<typeof loadJobs>>;
}) {
  const router = useRouter();
  const { job: selected } = Route.useSearch();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState<string>();
  const [filter, setFilter] = useState("All work");
  const [now, setClock] = useState(Date.now);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const timer = setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<string | undefined>(undefined);
  const [lastJobs, setLastJobs] = useState(loaded.jobs);
  useEffect(() => {
    if (loaded.jobs.ok) setLastJobs(loaded.jobs);
  }, [loaded.jobs]);
  const result = loaded.jobs.ok ? loaded.jobs : lastJobs;
  const refreshError = !loaded.jobs.ok && lastJobs.ok ? loaded.jobs.error : "";
  const jobs = result.ok ? result.value : [];
  const job = jobs.find((item) => item.id === selected);
  const running = jobs.some(
    (item) => active(item) || (item.cancelRequested && canStop(item)),
  );
  async function refresh() {
    await router.invalidate({
      filter: (match) =>
        match.routeId === Route.id && match.params.agentId === agent.id,
      sync: true,
    });
  }
  const focusJobId = job?.id;
  useEffect(() => {
    if (focusJobId) {
      heading.current?.focus();
      previous.current = focusJobId;
    } else if (previous.current)
      document.getElementById(`job-${previous.current}`)?.focus();
  }, [focusJobId]);
  useEffect(() => {
    if (agent.kind !== "coding") return;
    let pending = false;
    const poll = async () => {
      if (
        pending ||
        document.visibilityState !== "visible" ||
        !navigator.onLine
      )
        return;
      pending = true;
      try {
        await router.invalidate({
          filter: (match) =>
            match.routeId === Route.id && match.params.agentId === agent.id,
          sync: true,
        });
      } catch {
        setError("Could not refresh jobs. Try again.");
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void poll(), running ? 4000 : 15000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [router, agent.id, agent.kind, running]);
  async function manualRefresh() {
    if (!navigator.onLine) {
      setError("You’re offline. Showing the last saved job report.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await refresh();
    } catch {
      setError("Could not refresh jobs.");
    } finally {
      setBusy(false);
    }
  }
  async function stop(id: string) {
    if (stopping) return;
    setStopping(id);
    setError("");
    try {
      const result = await stopCodingJob({ data: { agentId: agent.id, id } });
      if (!result.ok) setError(result.error);
      await refresh();
    } catch {
      setError("Could not stop the job. Refresh before retrying.");
    } finally {
      setStopping(undefined);
    }
  }
  return (
    <section {...stylex.props(s.page)}>
      <AgentHeader agent={agent} />
      <div {...stylex.props(s.content)}>
        {(error || refreshError) && (
          <p role="alert" {...stylex.props(s.error)}>
            {error || refreshError}
          </p>
        )}
        {agent.kind !== "coding" ? (
          <p {...stylex.props(s.muted)}>
            Jobs are available for coding agents. Create a coding agent to
            manage development work.
          </p>
        ) : !result.ok ? (
          <div role="alert">
            <p>{result.error}</p>
            <Button
              onClick={() => void manualRefresh()}
              disabled={!interactive || busy}
            >
              Try again
            </Button>
          </div>
        ) : selected && !job ? (
          <>
            <Link
              to="/agents/$agentId/jobs"
              params={{ agentId: agent.id }}
              search={{}}
              {...stylex.props(s.back)}
            >
              ← All jobs
            </Link>
            <p role="alert">Job not found.</p>
          </>
        ) : job ? (
          <>
            <Link
              to="/agents/$agentId/jobs"
              params={{ agentId: agent.id }}
              search={{}}
              {...stylex.props(s.back)}
            >
              ← All jobs
            </Link>
            <div {...stylex.props(s.heading)}>
              <div>
                <h2 ref={heading} tabIndex={-1} {...stylex.props(s.title)}>
                  {job.title}
                </h2>
                <Status job={job} />
              </div>
              <div {...stylex.props(s.actions)}>
                <Primary job={job} now={now} />
                <Button
                  onClick={() => {
                    document.getElementById("job-worker-feedback")?.click();
                    requestAnimationFrame(() =>
                      document.getElementById("job-feedback")?.focus(),
                    );
                  }}
                >
                  Leave feedback ↓
                </Button>
                <Button
                  disabled={!interactive || busy}
                  onClick={() => void manualRefresh()}
                >
                  Refresh
                </Button>
              </div>
            </div>
            <div {...stylex.props(s.workspace)}>
              <div>
                <section {...stylex.props(s.section)}>
                  <div {...stylex.props(s.sectionHeading)}>
                    <h3 {...stylex.props(s.sectionTitle)}>Current preview</h3>
                    <span {...stylex.props(s.muted)}>
                      {previewState(job.workspace, now) === "running"
                        ? "Reported running"
                        : job.workspace.previewAvailability === "not_needed"
                          ? "Not needed"
                          : previewState(job.workspace, now) === "unknown"
                            ? "Unknown · report expired"
                            : "Unavailable"}
                    </span>
                  </div>
                  <div {...stylex.props(s.preview)}>
                    <Icon name="monitor" size={24} />
                    <div {...stylex.props(s.previewText)}>
                      {job.workspace.previewUrl ? (
                        <>
                          <p {...stylex.props(s.summary)}>
                            Revision{" "}
                            {job.workspace.previewRevision || "not recorded"}
                          </p>
                          <span {...stylex.props(s.muted)}>
                            {new URL(job.workspace.previewUrl).host}
                          </span>
                        </>
                      ) : (
                        <p {...stylex.props(s.summary)}>
                          No preview has been shared yet.
                        </p>
                      )}
                    </div>
                    {job.workspace.previewUrl && (
                      <a
                        href={job.workspace.previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        {...stylex.props(s.actionLink)}
                      >
                        {previewState(job.workspace, now) === "running"
                          ? "Open ↗"
                          : "Try last preview ↗"}
                      </a>
                    )}
                  </div>
                  {previewState(job.workspace, now) !== "running" && (
                    <p {...stylex.props(s.muted)}>
                      Preview availability does not change this job’s status.
                      Your work and feedback remain here.
                    </p>
                  )}
                  {job.workspace.previewReportedAt > 0 && (
                    <p {...stylex.props(s.muted)}>
                      Last reported{" "}
                      {new Date(
                        job.workspace.previewReportedAt,
                      ).toLocaleString()}
                      . Running reports expire after 15 minutes.
                    </p>
                  )}
                </section>
                <section {...stylex.props(s.section)}>
                  <h3 {...stylex.props(s.sectionTitle)}>Latest changes</h3>
                  <p {...stylex.props(s.summary)}>
                    {job.workspace.latestChanges ||
                      job.summary ||
                      "No update shared yet."}
                  </p>
                  {job.error && <p {...stylex.props(s.error)}>{job.error}</p>}
                </section>
                {job.workspace.pullRequests.length > 0 && (
                  <section {...stylex.props(s.section)}>
                    <h3 {...stylex.props(s.sectionTitle)}>Pull requests</h3>
                    <div {...stylex.props(s.actions)}>
                      {job.workspace.pullRequests.map((url, index) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          {...stylex.props(s.link)}
                        >
                          PR {index + 1} ↗
                        </a>
                      ))}
                    </div>
                    <p {...stylex.props(s.summary)}>
                      {job.workspace.verification ||
                        "Implementation verification has not been recorded."}
                    </p>
                    <p {...stylex.props(s.muted)}>
                      Integration verification: {job.workspace.integration}.
                    </p>
                  </section>
                )}
                <section {...stylex.props(s.section)}>
                  <h3 {...stylex.props(s.sectionTitle)}>Task description</h3>
                  <p {...stylex.props(s.summary)}>
                    {job.assignment || job.brief}
                  </p>
                  {/^https?:\/\//i.test(job.sourceUrl) && (
                    <a
                      href={job.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      {...stylex.props(s.link)}
                    >
                      Open task source ↗
                    </a>
                  )}
                </section>
                <details {...stylex.props(s.technical)}>
                  <summary {...stylex.props(s.technicalSummary)}>
                    Technical details & worker output
                  </summary>
                  <dl {...stylex.props(s.metadata)}>
                    {[
                      ["Machine", job.remoteTarget || "Roost host"],
                      ["Workspace", job.cwd],
                      ["Herdr session", job.sessionName],
                      ["Worker", `${job.workerName} · ${job.workerKind}`],
                      ["Execution state", job.status],
                    ].map(([key, value]) => (
                      <div key={key} style={{ display: "contents" }}>
                        <dt>{key}</dt>
                        <dd {...stylex.props(s.value)}>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <pre {...stylex.props(s.output)}>
                    {job.output || "No output yet."}
                  </pre>
                  {canStop(job) && (
                    <Button
                      disabled={Boolean(stopping) || job.cancelRequested}
                      onClick={() => void stop(job.id)}
                    >
                      {stopping === job.id || job.cancelRequested
                        ? "Stopping…"
                        : "Stop job"}
                    </Button>
                  )}
                </details>
              </div>
              <div>
                {loaded.detail?.ok ? (
                  <Discussion
                    key={job.id}
                    agent={agent}
                    job={job}
                    feedback={loaded.detail.value.feedback}
                    messages={loaded.detail.value.messages}
                    queueBlockers={loaded.detail.value.queueBlockers}
                    refresh={refresh}
                  />
                ) : (
                  <p role="alert">
                    {loaded.detail && !loaded.detail.ok
                      ? loaded.detail.error
                      : "Loading discussion…"}
                  </p>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 {...stylex.props(s.srOnly)}>Jobs</h2>
            <div {...stylex.props(s.toolbar)}>
              <nav aria-label="Filter jobs" {...stylex.props(s.filters)}>
                {["All work", "Needs you", "Completed"].map((label) => (
                  <Button
                    key={label}
                    aria-pressed={filter === label}
                    disabled={!interactive}
                    xstyle={filter === label ? s.selected : undefined}
                    onClick={() => setFilter(label)}
                  >
                    {label}
                  </Button>
                ))}
              </nav>
              <Button
                disabled={!interactive || busy}
                onClick={() => void manualRefresh()}
              >
                {busy ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
            {!jobs.length ? (
              <div {...stylex.props(s.empty)}>
                <h3 {...stylex.props(s.title)}>No jobs yet</h3>
                <p {...stylex.props(s.muted)}>
                  Give {agent.name} a coding task in conversation to begin.
                </p>
                <Link
                  to="/agents/$agentId"
                  params={{ agentId: agent.id }}
                  {...stylex.props(s.link)}
                >
                  Start in conversation →
                </Link>
              </div>
            ) : (
              <ul {...stylex.props(s.list)}>
                {jobs
                  .filter(
                    (item) =>
                      filter === "All work" ||
                      (filter === "Completed"
                        ? item.status === "completed"
                        : ["Ready for feedback", "Blocked", "Failed"].includes(
                            jobWorkflowLabel(item, item.workspace),
                          )),
                  )
                  .map((item) => (
                    <li key={item.id} {...stylex.props(s.row)}>
                      <div {...stylex.props(s.rowMain)}>
                        <Link
                          id={`job-${item.id}`}
                          to="/agents/$agentId/jobs"
                          params={{ agentId: agent.id }}
                          search={{ job: item.id }}
                          {...stylex.props(s.jobLink)}
                        >
                          {item.title}
                        </Link>
                        <p {...stylex.props(s.summary)}>
                          {item.workspace.latestChanges.split("\n")[0] ||
                            item.summary ||
                            item.error ||
                            "Waiting for an update."}
                        </p>
                        <div {...stylex.props(s.rowMeta)}>
                          <Status job={item} />
                          {item.workspace.pullRequests.map((url, i) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              {...stylex.props(s.link)}
                            >
                              PR {i + 1} ↗
                            </a>
                          ))}
                        </div>
                      </div>
                      <div {...stylex.props(s.rowActions)}>
                        <Primary job={item} now={now} />
                        <time
                          dateTime={new Date(item.updatedAt).toISOString()}
                          {...stylex.props(s.muted)}
                        >
                          {new Date(item.updatedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </time>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

type Draft = { text: string; requestId: string; previewRevision: string };
function Discussion({
  agent,
  job,
  feedback,
  messages,
  queueBlockers,
  refresh,
}: {
  job: Job;
  agent: Agent;
  feedback: JobFeedback[];
  messages: WorkerMessage[];
  queueBlockers: string[];
  refresh: () => Promise<void>;
}) {
  const [discuss, setDiscuss] = useState(false);
  const [worker, setWorker] = useState(true);
  const key = `roost-job-feedback-${job.agentId}-${job.id}`;
  const [draft, setDraft] = useState<Draft>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const sending = useRef(false);
  const continuation = useRef<
    { requestId: string; messageIds: string[] } | undefined
  >(undefined);
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || "null");
      if (
        value &&
        typeof value.text === "string" &&
        typeof value.requestId === "string"
      )
        setDraft(value);
      const pending = JSON.parse(
        sessionStorage.getItem(`${key}-continue`) || "null",
      );
      if (pending) {
        continuation.current = pending;
        setSelected(pending.messageIds);
      }
    } catch {
      setError(
        "Draft storage is unavailable. Keep this page open until your feedback is saved.",
      );
    }
    setReady(true);
  }, [key]);
  function edit(text: string) {
    const next = {
      text,
      requestId: crypto.randomUUID(),
      previewRevision: job.workspace.previewRevision,
    };
    setDraft(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError("Could not preserve this draft across reloads.");
    }
  }
  async function save() {
    if (sending.current || !draft?.text.trim()) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await postJobFeedback({
        data: { agentId: job.agentId, id: job.id, ...draft },
      });
      if (!result.ok) throw new Error(result.error);
      setDraft(undefined);
      try {
        sessionStorage.removeItem(key);
      } catch {}
      await refresh();
      setNotice("Feedback saved. The worker was not resumed.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save feedback. Retry uses the same request ID.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function resume() {
    if (sending.current || !selected.length) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const pending = continuation.current ?? {
        requestId: crypto.randomUUID(),
        messageIds: [...selected],
      };
      continuation.current = pending;
      sessionStorage.setItem(`${key}-continue`, JSON.stringify(pending));
      const result = await submitJobFeedback({
        data: {
          agentId: job.agentId,
          id: job.id,
          ...pending,
          revision: job.revision,
        },
      });
      if (!result.ok) throw new Error(result.error);
      sessionStorage.removeItem(`${key}-continue`);
      continuation.current = undefined;
      setSelected([]);
      await refresh();
      setNotice(
        `Continuation ${result.value.status}. Delivery is tracked below; this does not create another job.`,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not queue feedback. Retry uses the same request ID.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  const mayContinue =
    ["review", "blocked"].includes(job.status) &&
    ["idle", "done"].includes(job.lastWorkerState) &&
    Boolean(job.sessionIdentity) &&
    !job.cancelRequested;
  return (
    <section {...stylex.props(s.discussion)}>
      <h3 {...stylex.props(s.sectionTitle)}>Discussion</h3>
      <p {...stylex.props(s.muted)}>
        Feedback and replies stay with this assignment.
      </p>
      <div {...stylex.props(s.filters)}>
        <Button
          aria-pressed={worker}
          xstyle={worker ? s.selected : undefined}
          onClick={() => setWorker(true)}
        >
          Talk to worker
        </Button>
        <Button
          id="job-worker-feedback"
          disabled={!ready}
          xstyle={!discuss && !worker ? s.selected : undefined}
          aria-pressed={!discuss && !worker}
          onClick={() => {
            setDiscuss(false);
            setWorker(false);
          }}
        >
          Worker feedback
        </Button>
        <Button
          disabled={!ready}
          xstyle={discuss && !worker ? s.selected : undefined}
          aria-pressed={discuss && !worker}
          onClick={() => {
            setDiscuss(true);
            setWorker(false);
          }}
        >
          Talk to agent
        </Button>
      </div>
      {worker ? (
        <WorkerDiscussion
          job={job}
          messages={messages}
          queueBlockers={queueBlockers}
          refresh={refresh}
        />
      ) : discuss ? (
        <div {...stylex.props(s.conversationPanel)}>
          <Conversation
            agent={agent}
            conversationId={job.workspace.conversationId}
            embedded
            title="Job discussion"
          />
        </div>
      ) : (
        <>
          {job.workspace.workflow === "feedback" && (
            <p {...stylex.props(s.muted)}>
              Waiting for your feedback. Saving a note keeps work paused;
              Continue sends the selected feedback to this same worker.
            </p>
          )}
          {feedback.map((item) => (
            <article key={item.id} {...stylex.props(s.message)}>
              <div {...stylex.props(s.author)}>
                You{" "}
                <span {...stylex.props(s.muted)}>
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
              <p {...stylex.props(s.messageText)}>{item.text}</p>
              <span {...stylex.props(s.muted)}>
                Preview {item.previewRevision || "not specified"} ·{" "}
                {item.delivery || "Saved; not submitted"}
              </span>
              {item.error && (
                <p role="alert" {...stylex.props(s.error)}>
                  {item.error}
                </p>
              )}
              {!item.inputId && (
                <label {...stylex.props(s.checkboxLabel)}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    disabled={!ready || busy || Boolean(continuation.current)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, item.id]
                          : previous.filter((id) => id !== item.id),
                      )
                    }
                  />
                  Include in continuation
                </label>
              )}
            </article>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            {...stylex.props(s.composer)}
          >
            <label htmlFor="job-feedback" {...stylex.props(s.label)}>
              Leave feedback
            </label>
            <textarea
              id="job-feedback"
              disabled={!ready || busy}
              value={draft?.text ?? ""}
              onChange={(event) => edit(event.target.value)}
              maxLength={16000}
              placeholder="What would you like to change?"
              {...stylex.props(s.textarea)}
            />
            <div {...stylex.props(s.toolbar)}>
              <span {...stylex.props(s.muted)}>
                On revision{" "}
                {draft?.previewRevision ||
                  job.workspace.previewRevision ||
                  "not specified"}
              </span>
              <Button type="submit" disabled={busy || !draft?.text.trim()}>
                Save feedback
              </Button>
            </div>
          </form>
          <Button
            disabled={
              busy ||
              !selected.length ||
              (!mayContinue && !continuation.current)
            }
            onClick={() => void resume()}
          >
            {busy ? "Saving…" : "Continue with selected feedback"}
          </Button>
          {!mayContinue && canStop(job) && (
            <p {...stylex.props(s.muted)}>
              Continuation is available when the existing worker is ready.
              Resolve terminal blockers before resuming.
            </p>
          )}
          {continuation.current && !busy && (
            <Button
              onClick={() => {
                continuation.current = undefined;
                try {
                  sessionStorage.removeItem(`${key}-continue`);
                } catch {}
                setSelected([]);
                setError("");
              }}
            >
              Clear local retry selection
            </Button>
          )}
          {error && (
            <p role="alert" {...stylex.props(s.error)}>
              {error}
            </p>
          )}
          <p role="status" {...stylex.props(s.muted)}>
            {notice}
          </p>
        </>
      )}
    </section>
  );
}

function WorkerDiscussion({
  job,
  messages,
  queueBlockers,
  refresh,
}: {
  job: Job;
  messages: WorkerMessage[];
  queueBlockers: string[];
  refresh: () => Promise<void>;
}) {
  const key = `roost-worker-draft-${job.agentId}-${job.id}`;
  const [draft, setDraft] = useState({ text: "", requestId: "" });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sending = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (
        saved &&
        typeof saved.text === "string" &&
        typeof saved.requestId === "string"
      )
        setDraft(saved);
    } catch {
      setError(
        "Draft storage is unavailable. Keep this page open until your message is sent.",
      );
    }
    setReady(true);
  }, [key]);
  function edit(text: string) {
    const next = { text, requestId: crypto.randomUUID() };
    setDraft(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      setError("Could not preserve this draft across reloads.");
    }
  }
  async function send() {
    if (sending.current || !draft.text.trim()) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await postWorkerMessage({
        data: { agentId: job.agentId, id: job.id, ...draft },
      });
      if (!result.ok) throw new Error(result.error);
      setDraft({ text: "", requestId: "" });
      try {
        sessionStorage.removeItem(key);
      } catch {}
      setNotice(
        "Queued for this worker's next safe boundary. Its current work was not interrupted.",
      );
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not send. Retry preserves the same message ID.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
      composer.current?.focus();
    }
  }
  const unavailable =
    job.cancelRequested ||
    ["completed", "cancelled", "failed", "queued", "starting"].includes(
      job.status,
    ) ||
    !job.sessionIdentity ||
    !["working", "idle", "done"].includes(job.lastWorkerState);
  return (
    <div>
      <p {...stylex.props(s.muted)}>
        Message this job's existing worker directly. Messages wait in order
        while it works, independently of the managing agent.
      </p>
      {queueBlockers
        .filter(
          (id) => !messages.some((m) => m.id === id && m.status === "failed"),
        )
        .map((inputId) => (
          <p key={inputId} {...stylex.props(s.error)}>
            An uncertain coordinator submission is holding this queue. Inspect
            it in the existing worker; it will not be replayed.{" "}
            <Button
              onClick={async () => {
                const result = await inspectWorkerFailure({
                  data: { agentId: job.agentId, id: job.id, inputId },
                });
                if (!result.ok) setError(result.error);
                else await refresh();
              }}
            >
              I inspected the submission; release remaining queue
            </Button>
          </p>
        ))}
      <p {...stylex.props(s.muted)}>
        Worker: {job.workerName} · {job.lastWorkerState || "not connected"}
      </p>
      <div
        {...stylex.props(s.workerLog)}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable conversation must be keyboard reachable.
        tabIndex={0}
        aria-label="Worker conversation"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {messages.map((message) => (
          <article key={message.id} {...stylex.props(s.message)}>
            <div {...stylex.props(s.author)}>
              You{" "}
              <span {...stylex.props(s.muted)}>
                {new Date(message.createdAt).toLocaleString()}
              </span>
            </div>
            <p {...stylex.props(s.messageText)}>{message.text}</p>
            <p {...stylex.props(s.muted)}>
              {message.status === "queued"
                ? "Queued · waiting for a safe worker boundary"
                : message.status === "responding"
                  ? "Responding · worker turn in progress"
                  : message.status === "delivered"
                    ? "Delivered · awaiting worker activity"
                    : message.status === "answered"
                      ? "Answered"
                      : message.status === "acknowledged"
                        ? "Inspected · not replayed"
                        : "Failed · inspect before sending a fresh instruction"}
            </p>
            {message.error && <p {...stylex.props(s.error)}>{message.error}</p>}
            {message.status === "failed" && (
              <Button
                onClick={async () => {
                  const result = await inspectWorkerFailure({
                    data: {
                      agentId: job.agentId,
                      id: job.id,
                      inputId: message.id,
                    },
                  });
                  if (!result.ok) setError(result.error);
                  else await refresh();
                }}
              >
                I inspected this submission in Herdr; release remaining queue
              </Button>
            )}
            {message.previewCheck && (
              <>
                <div {...stylex.props(s.author)}>Server live preview check</div>
                <PreviewReceipt value={message.previewCheck} />
              </>
            )}
            {message.response && (
              <>
                <div {...stylex.props(s.author)}>
                  Worker · captured response
                </div>
                <p {...stylex.props(s.messageText)}>{message.response}</p>
                <p {...stylex.props(s.muted)}>
                  Captured worker output; preview claims require the process and
                  endpoint evidence reported by the worker.
                </p>
              </>
            )}
          </article>
        ))}
      </div>
      {unavailable && (
        <p role="status" {...stylex.props(s.muted)}>
          {["completed", "cancelled", "failed"].includes(job.status)
            ? "This job has ended. Review its preserved conversation and work; this composer cannot reopen it."
            : "Resolve approvals or restore and verify this same worker in Herdr before continuing. Messages already queued remain visible."}
        </p>
      )}
      <form
        {...stylex.props(s.composer)}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="job-worker-message" {...stylex.props(s.label)}>
          Message worker
        </label>
        <textarea
          ref={composer}
          id="job-worker-message"
          aria-describedby="worker-message-help"
          readOnly={busy}
          disabled={!ready}
          value={draft.text}
          onChange={(event) => edit(event.target.value)}
          maxLength={16000}
          placeholder="Ask a question or give the worker an instruction…"
          {...stylex.props(s.textarea)}
        />
        <p id="worker-message-help" {...stylex.props(s.muted)}>
          Sending explicitly continues an idle or feedback-paused worker.
          Approval prompts must be resolved in Herdr.
        </p>
        <div {...stylex.props(s.toolbar)}>
          <Button
            disabled={busy || !ready}
            onClick={() => {
              edit(
                draft.text
                  ? `${draft.text}\n\nIs the dev server running for this preview?`
                  : "Is the dev server running for this preview?",
              );
              composer.current?.focus();
            }}
          >
            Ask preview status
          </Button>
          <Button
            type="submit"
            disabled={!ready || busy || unavailable || !draft.text.trim()}
          >
            {busy ? "Queueing…" : "Send to worker"}
          </Button>
        </div>
      </form>
      {error && (
        <p role="alert" {...stylex.props(s.error)}>
          {error}
        </p>
      )}
      <p role="status" {...stylex.props(s.muted)}>
        {notice}
      </p>
    </div>
  );
}

function PreviewReceipt({ value }: { value: string }) {
  let check: {
    status: string;
    checkedAt: number;
    url: string;
    reportedRevision: string;
    process: string;
    endpoint: string;
    blocker: string;
  };
  try {
    check = JSON.parse(value);
  } catch {
    return (
      <p {...stylex.props(s.muted)}>
        Preview check could not be read. Ask the worker to check again.
      </p>
    );
  }
  return (
    <div {...stylex.props(s.messageText)}>
      <p>
        {check.status === "running"
          ? "Running · worktree process and endpoint checked"
          : check.status === "unavailable"
            ? "Unavailable"
            : "Unverified"}{" "}
        · {new Date(check.checkedAt).toLocaleString()}
      </p>
      {check.url && <p>Reported URL: {check.url}</p>}
      {check.reportedRevision && (
        <p>Last reported revision: {check.reportedRevision}</p>
      )}
      {check.process && <p>{check.process}</p>}
      {check.endpoint && <p>{check.endpoint}</p>}
      {check.blocker && <p>{check.blocker}</p>}
    </div>
  );
}
