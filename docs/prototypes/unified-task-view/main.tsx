import { useState } from "react";
import { createRoot } from "react-dom/client";
import { tasks as initialTasks, type Task } from "./fixtures";
import "./styles.css";

const layouts = [
  "A · Task workspace",
  "B · Status board",
  "C · Attention inbox",
];

function TaskCard({
  task,
  selected,
  onSelect,
  stale,
}: {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  stale: boolean;
}) {
  return (
    <button
      type="button"
      className={`task-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="row">
        <span className="eyebrow">
          {task.id.toUpperCase()}{" "}
          <span className="priority">{task.priority}</span>
        </span>
        <span className="muted">{task.reserved ? "Slot held" : "No slot"}</span>
      </span>
      <strong>{task.title}</strong>
      <span className="row">
        <span className="pill">Notion · {task.status}</span>
        <span className={task.worker === "Blocked" ? "warning" : "muted"}>
          Worker · {task.worker}
        </span>
      </span>
      <span className="muted">
        GitHub ·{" "}
        {stale && task.pr !== "No PR"
          ? "Stale snapshot"
          : `${task.pr} / ${task.checks}`}
      </span>
      {task.attention && (
        <span className="attention-line">
          {task.attention} → {task.owner}
        </span>
      )}
    </button>
  );
}

function App() {
  const [tasks, setTasks] = useState(initialTasks);
  const [selected, setSelected] = useState("export");
  const [filter, setFilter] = useState("All tasks");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState(0);
  const [stale, setStale] = useState(false);
  const [detail, setDetail] = useState(true);
  const [notice, setNotice] = useState("");
  const task = tasks.find((item) => item.id === selected)!;
  const capacity = tasks.filter((item) => item.reserved).length;
  const attention = tasks.filter((item) => item.attention).length;
  const visible = tasks.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All tasks" ||
        (filter === "Needs you" && item.attention) ||
        (filter === "In progress" && item.reserved) ||
        (filter === "Backlog" && item.status === "Backlog")),
  );

  function select(item: Task) {
    setSelected(item.id);
    setDetail(true);
  }

  function destination(name: string) {
    setNotice(
      `Fixture destination: ${name}. In a connected experience this opens the source for ${task.title}. No external action was taken.`,
    );
  }

  function handoff() {
    setTasks((items) =>
      items.map((item) =>
        item.id === "search"
          ? {
              ...item,
              reserved: false,
              worker: "Idle",
              job: "completed",
              status: "Human review",
              checks: "3 passed · head c93f",
              attention: "Review requested",
              owner: "You",
              action: "Review PR and evidence",
              summary:
                "Simulated coordinator verification complete. Slot released; human acceptance is pending.",
            }
          : item,
      ),
    );
    setNotice(
      "Simulated verified handoff for Improve task search. A slot is available; the task is Human review, not Done. No task starts automatically.",
    );
  }

  return (
    <>
      <div className="fixture-banner">
        RESEARCH · Fictional fixtures · No live connections or actions
      </div>
      <header>
        <b>
          roost <span className="muted">/ Tasks</span>
        </b>
        <span>Project: Roost</span>
      </header>
      <main className={detail ? "mobile-detail" : ""}>
        <div className="page-heading">
          <div>
            <p className="eyebrow">PROJECT OVERVIEW</p>
            <h1>Work, with the whole picture.</h1>
            <p className="muted">
              Task intent, execution, and review — connected by task.
            </p>
          </div>
          <span className="research-label">
            Concept {String.fromCharCode(65 + layout)} ·{" "}
            {layout === 0 ? "Recommended" : "Alternative"}
          </span>
        </div>
        <nav className="layout-nav" aria-label="Layout options">
          {layouts.map((name, index) => (
            <button
              type="button"
              key={name}
              aria-pressed={layout === index}
              onClick={() => setLayout(index)}
            >
              {name}
            </button>
          ))}
        </nav>
        <section className="overview" aria-label="Capacity and attention">
          <div>
            <span className="eyebrow">EXECUTION CAPACITY</span>
            <h2>{capacity} / 2 task slots held</h2>
            <p>
              {capacity === 2
                ? "1 working · 1 blocked · no slot available"
                : "1 blocked · 1 slot available"}
            </p>
            <small>
              Blocked work keeps its slot until a confirmed handoff or stop.
            </small>
          </div>
          <div>
            <span className="eyebrow">HUMAN ATTENTION</span>
            <h2>{attention} tasks need you</h2>
            <p>Approval + experience review</p>
            <small>Human review is separate from execution capacity.</small>
          </div>
          <div>
            <span className="eyebrow">SOURCE FRESHNESS · FIXTURE</span>
            <p>
              Notion: observed 10:42 UTC
              <br />
              Worker: observed 10:42 UTC
              <br />
              <span className={stale ? "warning" : ""}>
                GitHub:{" "}
                {stale
                  ? "unavailable · last seen 10:12 UTC"
                  : "observed 10:42 UTC"}
              </span>
            </p>
          </div>
        </section>
        <div className="controls">
          <nav className="filters" aria-label="Filter tasks">
            {["All tasks", "Needs you", "In progress", "Backlog"].map(
              (name) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={filter === name}
                  onClick={() => {
                    setFilter(name);
                    setDetail(false);
                  }}
                >
                  {name}
                </button>
              ),
            )}
          </nav>
          <label className="search">
            Search tasks{" "}
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setDetail(false);
              }}
              placeholder="Search by title"
            />
          </label>
        </div>
        <p className="mobile-context">
          {capacity} / 2 slots held · {attention} tasks need you
        </p>
        <div
          className={`workspace layout-${layout} ${detail ? "show-detail" : "show-list"}`}
        >
          <section className="task-list" aria-label="Tasks">
            <div className="section-heading">
              <h2>
                {layout === 2 ? "Attention first" : "Tasks"}{" "}
                <span className="muted">{visible.length}</span>
              </h2>
              <small>
                {layout === 1
                  ? "Grouped by Notion status"
                  : "Priority within attention group"}
              </small>
            </div>
            {visible.length === 0 && (
              <p className="empty">
                No matching tasks. Clear search or choose All tasks.
              </p>
            )}
            <div className={layout === 1 ? "board" : "cards"}>
              {(layout === 1
                ? ["Backlog", "In progress", "Human review", "Done"]
                : layout === 2
                  ? ["Needs you", "Continuing without you"]
                  : ["All"]
              ).map((group) => (
                <div key={group} className="task-group">
                  {group !== "All" && <h3>{group}</h3>}
                  {visible
                    .filter(
                      (item) =>
                        group === "All" ||
                        (layout === 1
                          ? item.status === group
                          : Boolean(item.attention) ===
                            (group === "Needs you")),
                    )
                    .sort(
                      (a, b) =>
                        Number(Boolean(b.attention)) -
                          Number(Boolean(a.attention)) ||
                        a.priority.localeCompare(b.priority),
                    )
                    .map((item) => (
                      <TaskCard
                        key={item.id}
                        task={item}
                        selected={selected === item.id}
                        stale={stale}
                        onSelect={() => select(item)}
                      />
                    ))}
                </div>
              ))}
            </div>
          </section>
          <aside className="detail" aria-label="Task details">
            <button
              type="button"
              className="back"
              onClick={() => setDetail(false)}
            >
              ← Back to tasks
            </button>
            <p className="eyebrow">{task.priority} · SELECTED TASK</p>
            <h2>{task.title}</h2>
            <p>{task.summary}</p>
            <div className="next-action">
              <span className="eyebrow">
                NEXT ACTION · {task.owner.toUpperCase()}
              </span>
              <h3>
                {task.attention ||
                  (task.reserved ? "Work is continuing" : "No human blocker")}
              </h3>
              <p>
                {task.id === "export"
                  ? "Inspect the network request in the worker’s original terminal. GitHub also reports one failed check."
                  : task.status === "Human review"
                    ? "Review the result against the task’s acceptance criteria. Passing checks do not accept the experience."
                    : "Use the source context before deciding the next step."}
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => destination(task.action)}
              >
                {task.action} ↗
              </button>
            </div>
            <dl className="facts">
              <div>
                <dt>Notion task · {task.priority}</dt>
                <dd>{task.status}</dd>
                <small>
                  {task.status === "Backlog"
                    ? "Readiness: Ready to implement"
                    : "Task status is independent of worker state"}
                </small>
              </div>
              <div>
                <dt>Roost job / worker</dt>
                <dd>
                  {task.job} / {task.worker}
                </dd>
                <small>
                  {task.reserved
                    ? "Execution slot reserved"
                    : "No execution slot reserved"}
                </small>
              </div>
              <div>
                <dt>GitHub PR</dt>
                <dd>{task.pr}</dd>
                <small>
                  {task.pr === "No PR"
                    ? "No pull request linked"
                    : "Linked explicitly to this task; fixture repository"}
                </small>
              </div>
              <div>
                <dt>Checks {stale && "· STALE"}</dt>
                <dd>
                  {stale && task.pr !== "No PR"
                    ? "Current result unknown"
                    : task.checks}
                </dd>
                <small>
                  {stale
                    ? `Last observed: ${task.checks}`
                    : "Results belong to the shown commit; mergeability not evaluated"}
                </small>
              </div>
            </dl>
            <div className="source-links">
              {["Notion task", "Worker progress", "GitHub PR"].map((name) => (
                <button
                  type="button"
                  key={name}
                  disabled={
                    (name === "GitHub PR" && task.pr === "No PR") ||
                    (name === "Worker progress" && task.job === "No job")
                  }
                  onClick={() => destination(name)}
                >
                  {name} ↗
                </button>
              ))}
            </div>
            <p className="footnote">
              Only a human marks Done. Worker idle, job completed, passing
              checks, or a merged PR do not do this.
            </p>
          </aside>
        </div>
        <section className="simulation">
          <b>Try fixture scenarios</b>
          <div>
            <button type="button" onClick={() => setStale((value) => !value)}>
              {stale ? "Restore GitHub fixture" : "Simulate GitHub unavailable"}
            </button>
            <button type="button" disabled={capacity < 2} onClick={handoff}>
              Simulate verified handoff
            </button>
            <button
              type="button"
              onClick={() => {
                setTasks(initialTasks);
                setStale(false);
                setNotice("");
                setSelected("export");
                setFilter("All tasks");
                setQuery("");
                setDetail(true);
              }}
            >
              Reset fixtures
            </button>
          </div>
          <small>
            Scenarios change this page only. No starts, approvals, merges, or
            status writes.
          </small>
        </section>
        <p className="footnote">
          Compare the editable desktop/mobile concepts in designs/. Worker
          progress would open the monitor explored in PR #4.
        </p>
      </main>
      {notice && (
        <div className="notice-container">
          <section role="status" aria-label="Fixture result" className="notice">
            <h2>Simulation only</h2>
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice("")}>
              Close
            </button>
          </section>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
