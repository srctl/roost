import * as stylex from "@stylexjs/stylex";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AgentHeader } from "../components/agent-header";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/primitives";
import type { Agent } from "../features/agents/schema";
import {
  getCodingJobs,
  getCodingWorkspace,
  postJobFeedback,
  stopCodingJob,
  submitJobFeedback,
} from "../features/coding/functions";
import type { CodingJob } from "../features/coding/schema";
import {
  type CodingWorkspace,
  type JobFeedback,
  jobWorkflowLabel,
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
function Primary({ job }: { job: Job }) {
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
  if (w.previewAvailability === "running" && w.previewUrl)
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
  return <span {...stylex.props(s.muted)}>Preview unavailable</span>;
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
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<string | undefined>(undefined);
  const result = loaded.jobs;
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
      if (pending || document.visibilityState !== "visible") return;
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
        {error && (
          <p role="alert" {...stylex.props(s.error)}>
            {error}
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
                <Primary job={job} />
                <Button
                  onClick={() =>
                    document.getElementById("job-feedback")?.focus()
                  }
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
                      {job.workspace.previewAvailability === "running"
                        ? "Running"
                        : job.workspace.previewAvailability === "not_needed"
                          ? "Not needed"
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
                    {job.workspace.previewAvailability === "running" &&
                      job.workspace.previewUrl && (
                        <a
                          href={job.workspace.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          {...stylex.props(s.actionLink)}
                        >
                          Open ↗
                        </a>
                      )}
                  </div>
                  {job.workspace.previewAvailability === "unavailable" && (
                    <p {...stylex.props(s.muted)}>
                      Preview availability does not change this job’s status.
                      Your work and feedback remain here.
                    </p>
                  )}
                  {job.workspace.updatedAt > 0 && (
                    <p {...stylex.props(s.muted)}>
                      Last reported{" "}
                      {new Date(job.workspace.updatedAt).toLocaleString()}.
                      Availability is reported, not continuously health-checked.
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
                    job={job}
                    feedback={loaded.detail.value.feedback}
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
                        <Primary job={item} />
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
  job,
  feedback,
  refresh,
}: {
  job: Job;
  feedback: JobFeedback[];
  refresh: () => Promise<void>;
}) {
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
        Feedback for this assignment.{" "}
        <Link
          to="/agents/$agentId"
          params={{ agentId: job.agentId }}
          {...stylex.props(s.link)}
        >
          Open agent conversation
        </Link>
      </p>
      <p {...stylex.props(s.muted)}>
        Saved feedback also appears in the agent conversation.
      </p>
      {job.workspace.workflow === "feedback" && (
        <p {...stylex.props(s.muted)}>
          Waiting for your feedback. Saving a note keeps work paused; Continue
          sends the selected feedback to this same worker.
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
          busy || !selected.length || (!mayContinue && !continuation.current)
        }
        onClick={() => void resume()}
      >
        {busy ? "Saving…" : "Continue with selected feedback"}
      </Button>
      {!mayContinue && canStop(job) && (
        <p {...stylex.props(s.muted)}>
          Continuation is available when the existing worker is ready. Resolve
          terminal blockers before resuming.
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
    </section>
  );
}
