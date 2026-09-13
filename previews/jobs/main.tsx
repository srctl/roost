import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../../src/components/ui/button";
import { Avatar, Icon } from "../../src/components/ui/primitives";
import { fixtures, type Job, type WorkState } from "./fixtures";
import { theme } from "./theme.stylex";
import "./style.css";

type Saved = Record<
  string,
  { state?: WorkState; messages: { id: string; text: string }[]; draft: string }
>;
const storageKey = "roost-jobs-fixture-v1";
function readSaved(): Saved {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}
function Badge({ state }: { state: WorkState }) {
  return (
    <span className={`badge ${state.toLowerCase().replaceAll(" ", "-")}`}>
      <span aria-hidden="true">●</span> {state}
    </span>
  );
}
function App() {
  const [selected, setSelected] = useState(location.hash.slice(1));
  const [saved, setSaved] = useState<Saved>(readSaved);
  const [collapsed, setCollapsed] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationOpener = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState("All work");
  const [notice, setNotice] = useState("");
  const [sample, setSample] = useState<Job>();
  const [sampleReview, setSampleReview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastDetail = useRef("");
  const sampleOpener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const changed = () => {
      setSelected(location.hash.slice(1));
      setNotice("");
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (fixtures.some((item) => item.id === selected)) {
      heading.current?.focus();
      lastDetail.current = selected;
    } else if (lastDetail.current) {
      document
        .querySelector<HTMLAnchorElement>(
          `a.job-title[href="#${lastDetail.current}"]`,
        )
        ?.focus();
    }
  }, [selected]);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      setNotice(
        "Browser storage is unavailable. Demo feedback will last only until reload.",
      );
    }
  }, [saved]);
  const jobs = fixtures.map((job) => ({
    ...job,
    state: saved[job.id]?.state ?? job.state,
  }));
  const job = jobs.find((item) => item.id === selected);
  function update(id: string, patch: Partial<Saved[string]>) {
    setSaved((previous) => ({
      ...previous,
      [id]: { messages: [], draft: "", ...previous[id], ...patch },
    }));
  }
  function action(item: Job, review = false) {
    sampleOpener.current = document.activeElement as HTMLElement;
    setSample(item);
    setSampleReview(review);
    setNotice(
      review
        ? "Example PR stack — no live GitHub action."
        : "Example running preview — no real worker control.",
    );
  }
  function primary(item: Job) {
    if (item.state === "Ready for review" || item.state === "Completed")
      return (
        <Button
          className="primary"
          type="button"
          onClick={() => action(item, true)}
        >
          {item.state === "Completed" ? "View PR" : "Review PR"} ↗
        </Button>
      );
    if (item.preview === "Running")
      return (
        <Button className="primary" type="button" onClick={() => action(item)}>
          Open preview ↗
        </Button>
      );
    return <span className="unavailable">Preview unavailable</span>;
  }
  return (
    <div className={`${stylex.props(theme.tokens).className} preview-app`}>
      <div className="demo">
        <strong>Design preview · r04</strong>
        <span>
          Example jobs. Feedback is saved in this tab only. No workers are
          controlled.
        </span>
        <Button
          type="button"
          onClick={() => {
            setSaved({});
            setNotice("Demo reset.");
          }}
        >
          Reset demo
        </Button>
      </div>
      <div className="shell">
        {!collapsed && (
          <aside className="sidebar" aria-label="Agents">
            <div className="brand-row">
              <a className="brand" href="#all">
                roost
              </a>
              <Button
                aria-label="Collapse sidebar"
                aria-expanded={true}
                onClick={() => {
                  setCollapsed(true);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        'button[aria-label="Expand sidebar"]',
                      )
                      ?.focus(),
                  );
                }}
              >
                <Icon name="panel" />
              </Button>
            </div>
            <div className="sidebar-heading">Agents</div>
            <nav aria-label="Agents">
              <a className="agent-row" href="#all">
                <Avatar character="moss" size={24} />
                Roost
              </a>
            </nav>
          </aside>
        )}
        {collapsed && (
          <div className="expand-sidebar">
            <Button
              aria-label="Expand sidebar"
              aria-expanded={false}
              onClick={() => {
                setCollapsed(false);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      'button[aria-label="Collapse sidebar"]',
                    )
                    ?.focus(),
                );
              }}
            >
              <Icon name="panel" />
            </Button>
          </div>
        )}
        <main>
          <header className="topbar">
            <div className="identity">
              <Button
                className="mobile-menu"
                ref={navigationOpener}
                aria-label="Open navigation"
                onClick={() => setNavigationOpen(true)}
              >
                <Icon name="menu" />
              </Button>
              <Avatar character="moss" />
              <span>Roost</span>
            </div>
            <nav className="agent-tabs" aria-label="Roost views">
              <span
                className="inactive-tab"
                title="Conversation is not connected in this fixture"
              >
                Conversation
              </span>
              <a href="#all" aria-current="page">
                Jobs
              </a>
            </nav>
          </header>
          {!job ? (
            <div className="content list-content">
              <h1 className="sr-only">Jobs</h1>
              <div className="list-toolbar">
                <nav className="filters" aria-label="Filter jobs">
                  {["All work", "Needs you", "Completed"].map((label) => (
                    <Button
                      type="button"
                      key={label}
                      aria-pressed={filter === label}
                      onClick={() => setFilter(label)}
                    >
                      {label}
                      {label === "Needs you" && (
                        <span>
                          {
                            jobs.filter((item) =>
                              ["Ready for feedback", "Blocked"].includes(
                                item.state,
                              ),
                            ).length
                          }
                        </span>
                      )}
                    </Button>
                  ))}
                </nav>
                <span className="muted">Latest activity first</span>
              </div>
              <ul className="jobs">
                {jobs
                  .filter(
                    (item) =>
                      filter === "All work" ||
                      (filter === "Completed"
                        ? item.state === "Completed"
                        : ["Ready for feedback", "Blocked"].includes(
                            item.state,
                          )),
                  )
                  .map((item) => (
                    <li key={item.id}>
                      <div className="job-main">
                        <a className="job-title" href={`#${item.id}`}>
                          {item.title}
                        </a>
                        <p>{item.update}</p>
                        <div className="row-meta">
                          <Badge state={item.state} />
                          {item.pr && (
                            <Button
                              className="text-button"
                              type="button"
                              onClick={() => action(item, true)}
                            >
                              PR {item.pr}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="row-action">
                        {primary(item)}
                        <span className="muted">
                          {item.age === "Yesterday"
                            ? item.age
                            : `${item.age} ago`}
                        </span>
                      </div>
                    </li>
                  ))}
              </ul>
              <p className="list-note">
                A preview can stop while work stays open. Your assignment and
                discussion stay together.
              </p>
            </div>
          ) : (
            <div className="content detail-content">
              <a className="back" href="#all">
                ← All jobs
              </a>
              <div className="detail-heading">
                <div>
                  <h1 ref={heading} tabIndex={-1}>
                    {job.title}
                  </h1>
                  <Badge state={job.state} />
                </div>
                <div className="detail-actions">
                  {primary(job)}
                  <Button
                    type="button"
                    onClick={() => document.getElementById("feedback")?.focus()}
                  >
                    Leave feedback ↓
                  </Button>
                  {job.state === "Ready for review" &&
                    job.preview === "Running" && (
                      <Button type="button" onClick={() => action(job)}>
                        Open preview ↗
                      </Button>
                    )}
                </div>
              </div>
              <div className="workspace">
                <div className="work-main">
                  <section className="preview-section">
                    <div className="section-heading">
                      <h2>Current preview</h2>
                      <span
                        className={`availability ${job.preview === "Running" ? "live" : ""}`}
                      >
                        {job.preview === "Running" ? "● Running" : job.preview}
                      </span>
                    </div>
                    {job.preview === "Running" ? (
                      <div className="preview-surface">
                        <Icon name="monitor" size={24} />
                        <div>
                          <h3>Revision {job.revision}</h3>
                          <p>Example preview · {job.id}</p>
                        </div>
                        <Button
                          onClick={() => action(job)}
                          aria-label={`Open example preview for ${job.title}`}
                        >
                          <Icon name="expand" />
                          Open
                        </Button>
                      </div>
                    ) : (
                      <div className="preview-missing">
                        <h3>
                          {job.preview === "Not needed"
                            ? "Work is preserved in the PR"
                            : "Preview isn’t running right now"}
                        </h3>
                        <p>
                          {job.preview === "Not needed"
                            ? "You can revisit the changes and the discussion below."
                            : "Your work and feedback are still here. Preview availability doesn’t change this job’s status."}
                        </p>
                      </div>
                    )}
                    <div className="revision">
                      <span>
                        Revision {job.revision}{" "}
                        <span className="muted">· Latest shared version</span>
                      </span>
                      <span className="muted">Fixture</span>
                    </div>
                  </section>
                  <section>
                    <h2>Latest changes</h2>
                    <ul className="changes">
                      {job.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h2>Task description</h2>
                    <p className="description">{job.task}</p>
                  </section>
                  <details className="technical">
                    <summary>Technical details & worker output</summary>
                    <dl>
                      <dt>Assignment</dt>
                      <dd>fixture-{job.id} · unchanged</dd>
                      <dt>Worker identity</dt>
                      <dd>fixture-worker-{job.id} · simulated</dd>
                      <dt>Branch</dt>
                      <dd>example/{job.id}</dd>
                    </dl>
                    <pre>
                      Simulated activity only.{"\n"}Preview revision{" "}
                      {job.revision} recorded.{"\n"}No credentials, agents or
                      dispatch endpoints connected.
                    </pre>
                  </details>
                </div>
                <section className="discussion">
                  <div className="section-heading">
                    <h2>Discussion</h2>
                    <span className="muted">This assignment</span>
                  </div>
                  <div className="message">
                    <div className="author">
                      <Avatar character="moss" size={24} />
                      <strong>Roost</strong>
                      <span className="muted">Example update</span>
                    </div>
                    <p>{job.discussion}</p>
                  </div>
                  {(saved[job.id]?.messages ?? []).map((message) => (
                    <div className="message user-message" key={message.id}>
                      <div className="author">
                        <strong>You</strong>
                        <span className="muted">Saved in demo</span>
                      </div>
                      <p>{message.text}</p>
                    </div>
                  ))}
                  {job.state === "Ready for feedback" && (
                    <p className="pause-note">
                      Waiting for your feedback. The worker stays paused; the
                      current preview remains available while running.
                    </p>
                  )}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const text = saved[job.id]?.draft.trim();
                      if (!text) return;
                      update(job.id, {
                        messages: [
                          ...(saved[job.id]?.messages ?? []),
                          { id: crypto.randomUUID(), text },
                        ],
                        draft: "",
                      });
                      setNotice(
                        "Feedback saved in this demo. No message was sent to a worker.",
                      );
                    }}
                  >
                    <label htmlFor="feedback">
                      {job.state === "Completed"
                        ? "Add a note"
                        : "Leave feedback"}
                    </label>
                    <textarea
                      id="feedback"
                      placeholder="What would you like to change?"
                      value={saved[job.id]?.draft ?? ""}
                      onChange={(event) =>
                        update(job.id, { draft: event.target.value })
                      }
                    />
                    <div className="composer-footer">
                      <span className="muted">On revision {job.revision}</span>
                      <Button
                        type="submit"
                        disabled={!saved[job.id]?.draft.trim()}
                      >
                        Save feedback
                      </Button>
                    </div>
                  </form>
                  {["Ready for feedback", "Blocked"].includes(job.state) && (
                    <Button
                      className="continue"
                      type="button"
                      disabled={!saved[job.id]?.messages.length}
                      onClick={() => {
                        update(job.id, { state: "Working" });
                        setNotice(
                          "Simulated continuation of the same assignment and worker. No dispatch occurred.",
                        );
                      }}
                    >
                      Continue with feedback <span>→</span>
                    </Button>
                  )}
                  <p className="discussion-help">
                    Feedback stays with this assignment. Paused work resumes
                    only when you choose Continue.
                  </p>
                </section>
              </div>
            </div>
          )}
          <div role="status" className={notice ? "notice" : ""}>
            {notice}
          </div>
        </main>
      </div>
      <Dialog.Root
        open={Boolean(sample)}
        onOpenChange={(open) => {
          if (!open) setSample(undefined);
        }}
      >
        <Dialog.Portal {...stylex.props(theme.tokens)}>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Popup className="example-dialog" finalFocus={sampleOpener}>
            <div className="section-heading">
              <span className="muted">Example destination</span>
              <Button
                type="button"
                onClick={() => setSample(undefined)}
                aria-label="Close example"
              >
                <Icon name="close" />
              </Button>
            </div>
            <Dialog.Title>{sample?.title}</Dialog.Title>
            <p>
              {sampleReview && sample?.pr
                ? `Example PR stack: ${sample.pr}. Standalone review readiness is separate from integration verification.`
                : "This is a simulated preview destination. The Jobs workspace is the interactive design being reviewed."}
            </p>
            <p>No real worker, repository or external preview is connected.</p>
            <Button
              className="primary"
              type="button"
              onClick={() => setSample(undefined)}
            >
              Return to workspace
            </Button>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={navigationOpen} onOpenChange={setNavigationOpen}>
        <Dialog.Portal {...stylex.props(theme.tokens)}>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Popup
            className="navigation-dialog"
            finalFocus={navigationOpener}
          >
            <Dialog.Title className="sr-only">Agents navigation</Dialog.Title>
            <div className="brand-row">
              <span className="brand">roost</span>
              <Button
                aria-label="Close navigation"
                onClick={() => setNavigationOpen(false)}
              >
                <Icon name="close" />
              </Button>
            </div>
            <div className="sidebar-heading">Agents</div>
            <Button
              className="agent-row"
              onClick={() => {
                location.hash = "all";
                setNavigationOpen(false);
              }}
            >
              <Avatar character="moss" size={24} />
              Roost
            </Button>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
