import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { fixtures, type Job, type WorkState } from "./fixtures";
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
  const [filter, setFilter] = useState("All work");
  const [notice, setNotice] = useState("");
  const [sample, setSample] = useState<Job>();
  const [sampleReview, setSampleReview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const changed = () => {
      setSelected(location.hash.slice(1));
      setNotice("");
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    if (selected) heading.current?.focus();
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
  useEffect(() => {
    if (sample) dialog.current?.showModal();
  }, [sample]);
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
        <button
          className="primary"
          type="button"
          onClick={() => action(item, true)}
        >
          {item.state === "Completed" ? "View PR" : "Review PR"} ↗
        </button>
      );
    if (item.preview === "Running")
      return (
        <button className="primary" type="button" onClick={() => action(item)}>
          Open preview ↗
        </button>
      );
    return <span className="unavailable">Preview unavailable</span>;
  }
  return (
    <>
      <div className="demo">
        <strong>Design preview · r03</strong>
        <span>
          Example jobs. Feedback is saved in this tab only. No workers are
          controlled.
        </span>
        <button
          type="button"
          onClick={() => {
            setSaved({});
            setNotice("Demo reset.");
          }}
        >
          Reset demo
        </button>
      </div>
      <div className="shell">
        <aside className="sidebar">
          <a className="brand" href="#all">
            roost<span>◒</span>
          </a>
          <div className="space-label">YOUR WORKSPACE</div>
          <div className="project">
            <span className="avatar">R</span>
            <div>
              Roost<small>Coding agent</small>
            </div>
          </div>
          <nav aria-label="Workspace">
            <a className="nav-active" href="#all">
              ☷ <span>Jobs</span>
              <span className="count">6</span>
            </a>
          </nav>
          <div className="sidebar-foot">
            A little room for work in progress.
          </div>
        </aside>
        <main>
          <header className="topbar">
            <span>
              Roost <span className="muted">/ Coding</span>
            </span>
            <span className="muted">Preview workspace</span>
          </header>
          {!job ? (
            <div className="content list-content">
              <div className="page-title">
                <div className="eyebrow">PICK UP WHERE YOU LEFT OFF</div>
                <h1>Jobs</h1>
                <p>Ongoing work, a little closer to done.</p>
              </div>
              <div className="list-toolbar">
                <nav className="filters" aria-label="Filter jobs">
                  {["All work", "Needs you", "Completed"].map((label) => (
                    <button
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
                    </button>
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
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => action(item, true)}
                            >
                              PR {item.pr}
                            </button>
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
                  <div className="eyebrow">
                    ROOST / JOB {job.id.toUpperCase()}
                  </div>
                  <h1 ref={heading} tabIndex={-1}>
                    {job.title}
                  </h1>
                  <Badge state={job.state} />
                </div>
                <div className="detail-actions">
                  {primary(job)}
                  <button
                    type="button"
                    onClick={() => document.getElementById("feedback")?.focus()}
                  >
                    Leave feedback ↓
                  </button>
                  {job.state === "Ready for review" &&
                    job.preview === "Running" && (
                      <button type="button" onClick={() => action(job)}>
                        Open preview ↗
                      </button>
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
                      <button
                        className="preview-surface"
                        type="button"
                        onClick={() => action(job)}
                        aria-label={`Open example preview for ${job.title}`}
                      >
                        <div className="mini-browser">
                          <i />
                          <i />
                          <i />
                          <span>roost / {job.id} · example</span>
                        </div>
                        <div className="mini-app">
                          <div className="mini-nav">
                            roost
                            <br />
                            <br />⌂<br />☷<br />⚙
                          </div>
                          <div className="mini-content">
                            <span className="eyebrow">YOUR WORK, IN VIEW</span>
                            <h3>
                              {job.id === "jobs"
                                ? "A place to keep going."
                                : job.title}
                            </h3>
                            <div className="mini-row">
                              <span>Current work</span>
                              <span>Ready to try ↗</span>
                            </div>
                            <div className="mini-row">
                              <span>Latest changes</span>
                              <span>Revision {job.revision}</span>
                            </div>
                            <div className="mini-row">
                              <span>Feedback</span>
                              <span>Keep the conversation going</span>
                            </div>
                          </div>
                        </div>
                        <div className="preview-caption">
                          Explore example preview <span>↗</span>
                        </div>
                      </button>
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
                      <span className="avatar small">R</span>
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
                      Ⅱ Waiting for your feedback. The worker stays paused; the
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
                      <button
                        type="submit"
                        disabled={!saved[job.id]?.draft.trim()}
                      >
                        Save feedback
                      </button>
                    </div>
                  </form>
                  {["Ready for feedback", "Blocked"].includes(job.state) && (
                    <button
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
                    </button>
                  )}
                  <p className="discussion-help">
                    Saving feedback keeps work paused. Continue resumes this
                    same assignment in the demo.
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
      <dialog
        className="example-dialog"
        ref={dialog}
        onClose={() => setSample(undefined)}
      >
        <div className="section-heading">
          <span className="eyebrow">INTERACTIVE FIXTURE</span>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close example"
          >
            ✕
          </button>
        </div>
        <h2>{sample?.title}</h2>
        <p>
          {sampleReview && sample?.pr
            ? `Example PR stack: ${sample.pr}. Standalone review readiness is separate from integration verification.`
            : "This is a simulated preview destination. The Jobs workspace is the interactive design being reviewed."}
        </p>
        <p>No real worker, repository or external preview is connected.</p>
        <button
          className="primary"
          type="button"
          onClick={() => dialog.current?.close()}
        >
          Return to workspace
        </button>
      </dialog>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
