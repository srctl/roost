import { readdir, readFile, readlink, realpath } from "node:fs/promises";
import type { CodingJob } from "../../features/coding/schema";

export type PreviewCheck = {
  status: "running" | "unavailable" | "unverified";
  checkedAt: number;
  url: string;
  reportedRevision: string;
  process: string;
  endpoint: string;
  blocker: string;
};
// No shells, service control, arbitrary-host requests or redirects. A local
// listener must belong to a process in the job worktree before HTTP is probed.
// Remote/proxied previews are left to the worker on its execution machine.
export async function checkJobPreview(
  job: Pick<CodingJob, "cwd" | "remoteTarget">,
  url: string,
  revision: string,
  otherWorktrees: string[] = [],
): Promise<PreviewCheck> {
  const result: PreviewCheck = {
    status: "unverified",
    checkedAt: Date.now(),
    url,
    reportedRevision: revision,
    process: "",
    endpoint: "",
    blocker: "",
  };
  if (job.remoteTarget)
    return {
      ...result,
      blocker:
        "Remote job: the worker must inspect its job-owned service and endpoint on the execution machine.",
    };
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return {
      ...result,
      blocker: "No valid preview endpoint has been reported.",
    };
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    !["127.0.0.1"].includes(target.hostname)
  )
    return {
      ...result,
      blocker:
        "The server can verify only a job-owned loopback endpoint. The worker must verify this public/proxied endpoint and its service.",
    };
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  try {
    const cwd = await realpath(job.cwd);
    for (const other of otherWorktrees) {
      const path = await realpath(other).catch(() => "");
      if (
        path &&
        (path === cwd ||
          path.startsWith(`${cwd}/`) ||
          cwd.startsWith(`${path}/`))
      )
        return {
          ...result,
          blocker:
            "This worktree overlaps another job. Process ownership is ambiguous; the worker must identify and check its specific service.",
        };
    }
    const sockets = new Set<string>();
    for (const table of ["tcp"]) {
      const rows = (await readFile(`/proc/net/${table}`, "utf8"))
        .trim()
        .split("\n")
        .slice(1);
      for (const row of rows) {
        const columns = row.trim().split(/\s+/);
        if (
          columns[3] === "0A" &&
          ["0100007F", "00000000"].includes(columns[1]?.split(":")[0] ?? "") &&
          Number.parseInt(columns[1]?.split(":")[1] ?? "", 16) === port
        )
          sockets.add(columns[9] ?? "");
      }
    }
    if (!sockets.size)
      return {
        ...result,
        status: "unavailable",
        blocker: `No TCP listener exists on preview port ${port}. Nothing was started.`,
      };
    for (const pid of (await readdir("/proc")).filter((name) =>
      /^\d+$/.test(name),
    )) {
      try {
        const processCwd = await readlink(`/proc/${pid}/cwd`);
        if (processCwd !== cwd && !processCwd.startsWith(`${cwd}/`)) continue;
        for (const fd of await readdir(`/proc/${pid}/fd`)) {
          const socket = await readlink(`/proc/${pid}/fd/${fd}`).catch(
            () => "",
          );
          if (sockets.has(socket.replace(/^socket:\[(\d+)\]$/, "$1"))) {
            result.process = `PID ${pid}, cwd ${processCwd}, listening on ${port}`;
            break;
          }
        }
        if (result.process) break;
      } catch {
        /* Process exited or is not inspectable. */
      }
    }
    if (!result.process)
      return {
        ...result,
        blocker:
          "The listening socket could not be attributed to a process in this job's worktree. No endpoint request was made.",
      };
    const response = await fetch(target, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    result.endpoint = `HEAD ${target.href}: HTTP ${response.status}`;
    if (
      response.status >= 200 &&
      response.status < 400 &&
      response.status !== 301 &&
      response.status !== 302 &&
      response.status !== 303 &&
      response.status !== 307 &&
      response.status !== 308
    )
      result.status = "running";
    else {
      result.status = "unavailable";
      result.blocker = `The endpoint returned HTTP ${response.status}; redirects are not followed.`;
    }
    await response.body?.cancel();
    return { ...result, checkedAt: Date.now() };
  } catch (error) {
    return {
      ...result,
      checkedAt: Date.now(),
      blocker: `Live preview check failed: ${error instanceof Error ? error.message : "unknown error"}. Nothing was started or restarted.`,
    };
  }
}
