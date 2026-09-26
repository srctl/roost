// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the output region must support keyboard scrolling.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Baseline } from "./.baseline";
import { agent, jobs } from "./fixtures";
import "./styles.css";

const labels = {
  running: "Running",
  blocked: "Needs attention",
  review: "Ready for review",
};
const samples = [
  "10:42:03  Codex › Sketching the monitor with explicit freshness and attention states.",
  "10:42:06  $ pnpm typecheck  [simulated command]",
  "10:42:09  Fixture result: typecheck passed. No command was executed.",
];
function Monitor() {
  const [selected, setSelected] = useState(0);
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [connected, setConnected] = useState(true);
  const [follow, setFollow] = useState(true);
  const output = useRef<HTMLPreElement>(null);
  const job = jobs[selected]!;
  useEffect(() => {
    if (!playing || !connected) return;
    const timer = setInterval(
      () => setCount((n) => Math.min(n + 1, samples.length)),
      1200,
    );
    return () => clearInterval(timer);
  }, [playing, connected]);
  useEffect(() => {
    if (follow && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [count, follow, selected]);
  const state = job.status as keyof typeof labels;
  return (
    <main className="monitor">
      <div className="heading">
        <div>
          <p className="eyebrow">PROJECT / SRCTL/ROOST</p>
          <h1>Coding work</h1>
          <p>Follow the work. Know when you’re needed.</p>
        </div>
        <span className="pill">3 fixture jobs</span>
      </div>
      <div className="workspace">
        <aside aria-label="Coding jobs" className="jobs">
          <h2>
            Jobs <span>01 active</span>
          </h2>
          {jobs.map((item, i) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={i === selected}
              className={`job ${i === selected ? "selected" : ""}`}
              onClick={() => setSelected(i)}
            >
              <span className={`status ${item.status}`}>
                {labels[item.status as keyof typeof labels]}
              </span>
              <strong>{item.title}</strong>
              <span>
                {item.workerKind} · {item.remoteTarget}
              </span>
            </button>
          ))}
          <p className="aside-note">
            A worker becoming idle starts review. It does not mark the task
            complete.
          </p>
        </aside>
        <section className="detail" aria-label="Selected job">
          <div className="job-top">
            <span className={`status ${state}`}>{labels[state]}</span>
            <span className="muted">Updated 10:42 UTC · fixture</span>
          </div>
          <h2>{job.title}</h2>
          <p>{job.summary}</p>
          {state === "blocked" && (
            <div className="notice" role="status">
              <strong>Approval needed in the worker terminal</strong>
              <p>
                Open your existing Herdr session “{job.sessionName}” on{" "}
                {job.remoteTarget}. This monitor cannot answer approvals or send
                keystrokes.
              </p>
            </div>
          )}
          {state === "review" && (
            <div className="notice">
              <strong>Coordinator review pending</strong>
              <p>
                Verify the diff, checks, and acceptance criteria before
                recording completion. No PR is attached to this fixture.
              </p>
            </div>
          )}
          <dl className="metadata">
            <div>
              <dt>Worker</dt>
              <dd>{job.workerName}</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>{job.sessionName}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{job.cwd}</dd>
            </div>
          </dl>
          <section className="terminal" aria-label="Read-only worker output">
            <div className="terminal-bar">
              <strong>Worker output</strong>
              <span>READ ONLY</span>
            </div>
            <div className="stream-status" role="status">
              {!connected
                ? "Connection lost · retained snapshot · worker status unknown"
                : count === samples.length
                  ? "Fixture replay complete · no live connection"
                  : "Fixture snapshot · last observed 10:42:00 UTC"}
            </div>
            <pre ref={output} tabIndex={0}>
              {job.output}
              {selected === 0 && count > 0
                ? `\n\n${samples.slice(0, count).join("\n")}`
                : ""}
            </pre>
            <div className="terminal-footer">
              <label>
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                />{" "}
                Follow output
              </label>
              <span>Snapshot tail · earlier output may be missing</span>
            </div>
          </section>
          <details className="assignment">
            <summary>Assignment and review criteria</summary>
            <p>{job.assignment}</p>
            <p>
              Separate PR, screenshots, findings, and checks. No merge or
              deployment.
            </p>
          </details>
          <div className="demo-controls">
            <span>Demo controls</span>
            <button
              type="button"
              disabled={selected !== 0 || !connected}
              onClick={() => {
                setCount(0);
                setPlaying(true);
              }}
            >
              Replay fixture
            </button>
            <button
              type="button"
              onClick={() => setConnected((value) => !value)}
            >
              {connected ? "Simulate disconnect" : "Restore fixture connection"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
function App() {
  const baseline =
    new URLSearchParams(location.search).get("view") === "baseline";
  return (
    <>
      <div className="fixture-banner">
        <strong>
          {baseline
            ? "BEFORE · EXISTING JOBS CONTENT"
            : "AFTER · MONITORING PROTOTYPE"}
        </strong>
        <span>Fixture data · no live workers or terminal connection</span>
        <a href={baseline ? "/" : "/?view=baseline"}>
          {baseline ? "View prototype →" : "View baseline →"}
        </a>
      </div>
      <div className="shell">
        <header className="shared-header">
          <strong>◈ Roost</strong>
          <span>Conversation</span>
          <b>Jobs</b>
        </header>
        {baseline ? (
          <Baseline agent={agent} loaded={{ ok: true, value: jobs }} />
        ) : (
          <Monitor />
        )}
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
