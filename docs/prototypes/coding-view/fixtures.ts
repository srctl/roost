import type { Agent } from "../../../src/features/agents/schema";
import type { CodingJob } from "../../../src/features/coding/schema";

export const agent = { id: "fixture", name: "Roost", kind: "coding" } as Agent;
const time = Date.parse("2026-09-08T10:42:00Z");
export const jobs = [
  {
    id: "monitor",
    title: "Better view for coding work",
    status: "running",
    assignment:
      "Investigate browser terminal streaming and Rove reuse. Build a reviewable monitoring prototype.",
    summary:
      "Comparing the current output snapshots with Rove’s session model.",
    output:
      "$ rg -n 'output|capture' src/server/coding\nherdr.server.ts:455  output: String(output.text).slice(-OUTPUT_TAIL)\n\nCodex › Found an ownership check before and after output capture.\nCodex › Next: sketch a read-only monitor and verify mobile layout.",
    sessionName: "coding-view",
    workerName: "codex-monitor",
    workerKind: "codex",
    cwd: "/workspace/roost",
    remoteTarget: "dev-machine",
    updatedAt: time,
    sourceUrl: "",
    error: "",
    cancelRequested: false,
  },
  {
    id: "approval",
    title: "Repair export flow",
    status: "blocked",
    assignment: "Investigate the export failure and prepare a fix.",
    summary: "Worker needs an approval in its original terminal.",
    output:
      "Codex › Network access requires approval.\nWaiting for the user in the worker terminal.",
    sessionName: "export-fix",
    workerName: "codex-export",
    workerKind: "codex",
    cwd: "/workspace/roost-export",
    remoteTarget: "dev-machine",
    updatedAt: time,
    sourceUrl: "",
    error: "",
    cancelRequested: false,
  },
  {
    id: "review",
    title: "Compact conversation spacing",
    status: "review",
    assignment: "Prepare a compact spacing option for review.",
    summary: "Worker is idle. Coordinator verification is still required.",
    output:
      "Codex › Fixture checks passed.\nCodex › Ready for coordinator review; no merge requested.",
    sessionName: "spacing",
    workerName: "codex-spacing",
    workerKind: "codex",
    cwd: "/workspace/roost-spacing",
    remoteTarget: "dev-machine",
    updatedAt: time,
    sourceUrl: "",
    error: "",
    cancelRequested: false,
  },
] as CodingJob[];
