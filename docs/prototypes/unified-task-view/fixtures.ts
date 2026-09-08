import type { Agent } from "../../../src/features/agents/schema";
import type { CodingJob } from "../../../src/features/coding/schema";

export const agent = { id: "fixture", name: "Roost", kind: "coding" } as Agent;
export interface Task {
  id: string;
  title: string;
  priority: string;
  status: string;
  job: string;
  worker: string;
  reserved: boolean;
  pr: string;
  checks: string;
  summary: string;
  attention: string;
  action: string;
  owner: string;
}
export const tasks: Task[] = [
  {
    id: "export",
    title: "Repair export flow",
    priority: "P1",
    status: "In progress",
    job: "blocked",
    worker: "Blocked",
    reserved: true,
    pr: "Draft #142",
    checks: "1 failed · head b72e",
    summary: "Export fix prepared; network approval is holding verification.",
    attention: "Approval needed",
    action: "Inspect worker terminal",
    owner: "You",
  },
  {
    id: "search",
    title: "Improve task search",
    priority: "P1",
    status: "In progress",
    job: "running",
    worker: "Working",
    reserved: true,
    pr: "Open #143",
    checks: "Running · head c93f",
    summary: "Worker is testing keyboard navigation. Next: prepare evidence.",
    attention: "",
    action: "View worker progress",
    owner: "Worker",
  },
  {
    id: "spacing",
    title: "Compact conversation spacing",
    priority: "P2",
    status: "Human review",
    job: "completed",
    worker: "Idle",
    reserved: false,
    pr: "Open #141",
    checks: "3 passed · head a61d",
    summary: "Coordinator verified evidence. Your experience review is next.",
    attention: "Review requested",
    action: "Review PR and evidence",
    owner: "You",
  },
  {
    id: "offline",
    title: "Explain offline recovery",
    priority: "P1",
    status: "Backlog",
    job: "No job",
    worker: "Not started",
    reserved: false,
    pr: "No PR",
    checks: "Not applicable",
    summary: "Ready to implement. Waiting for a task slot.",
    attention: "",
    action: "Discuss next assignment",
    owner: "Coordinator",
  },
  {
    id: "archive",
    title: "Clarify archived tasks",
    priority: "P3",
    status: "Done",
    job: "completed",
    worker: "Idle",
    reserved: false,
    pr: "Merged #139",
    checks: "2 passed · merged head",
    summary: "Human marked Done after acceptance review.",
    attention: "",
    action: "View decision record",
    owner: "You",
  },
];
const time = Date.parse("2026-09-08T10:42:00Z");
export const jobs = tasks.slice(0, 3).map((task) => ({
  id: task.id,
  title: task.title,
  status: task.job,
  assignment: task.summary,
  summary: task.summary,
  output: `Fixture Codex: ${task.summary}`,
  sessionName: `fixture-${task.id}`,
  workerName: `codex-${task.id}`,
  workerKind: "codex",
  cwd: `/fixture/${task.id}`,
  remoteTarget: "fixture-machine",
  updatedAt: time,
  sourceUrl: "",
  error: "",
  cancelRequested: false,
})) as CodingJob[];
