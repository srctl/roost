import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { readRelease } from "../cli/releases";
import { type Installation, serviceName } from "../cli/service";
import { maintenance } from "../cli/state";
import { stageArtifact } from "./artifact";
import type { EngineAdapter } from "./engine";
import { validateInstallation, validateService } from "./enrollment";
import { readGate } from "./gate";
import { execute } from "./process";

/** Labels alone do not establish quiescence. Missing/stale/changed identity
 * observations never authorize stopping an installation. */
export function codingWorkUncertain(
  j: Record<string, unknown>,
  now = Date.now(),
) {
  if (
    j.lastWorkerState === "not_started" &&
    j.status === "blocked" &&
    !j.observedWorking &&
    !j.sessionIdentity &&
    !j.nativeSessionId
  )
    return false;
  return (
    j.status !== "review" ||
    !j.observedWorking ||
    !["idle", "done"].includes(String(j.lastWorkerState)) ||
    !!j.cancelRequested ||
    !j.sessionIdentity ||
    !j.nativeSessionId ||
    Number(j.lastCheckedAt) < now - 15000 ||
    !Number.isFinite(Number(j.lastCheckedAt)) ||
    !!j.error
  );
}
export function systemdAdapter(
  c: Installation,
  support: string,
  token?: string,
): EngineAdapter {
  const unit = serviceName(c);
  const control = (action: "start" | "stop") =>
    execute("/usr/bin/sudo", ["-n", "/usr/bin/systemctl", action, unit]);
  async function appProbe(path: string) {
    const gate = readGate(c.root);
    const response = await fetch(`http://127.0.0.1:${c.port}${path}`, {
      headers: { "X-Roost-Updater": gate.token ?? gate.operation ?? "" },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error("Application update probe unavailable.");
    return response.json();
  }
  return {
    async running() {
      const status = await execute("/usr/bin/systemctl", [
        "show",
        unit,
        "--property=ActiveState",
        "--value",
      ]);
      return status === "active" || status === "activating";
    },
    stage: (offer, id, signal, progress) =>
      stageArtifact(c.root, offer, id, support, signal, progress, token),
    async preflight(candidate) {
      await validateInstallation(c);
      await validateService(c);
      await readRelease(join(c.root, "releases", candidate));
      // sudo -n -l validates authorization without actually starting/stopping.
      for (const action of ["start", "stop"])
        await execute("/usr/bin/sudo", [
          "-n",
          "-l",
          "/usr/bin/systemctl",
          action,
          unit,
        ]);
      const fragment = await execute("/usr/bin/systemctl", [
        "show",
        unit,
        "--property=ExecStart",
        "--value",
      ]);
      if (!fragment.includes(join(c.root, "current", "runtime/node")))
        throw new Error("Service identity differs from enrollment.");
    },
    async admission(blocked) {
      maintenance(c.root, blocked);
    },
    async blockers(frozen) {
      let db: DatabaseSync | undefined;
      try {
        db = new DatabaseSync(join(c.root, "data", "roost.sqlite"), {
          readOnly: true,
        });
        db.exec("PRAGMA busy_timeout=5000");
      } catch {
        db?.close();
        return ["Work cannot be verified because its store is unavailable."];
      }
      const blockers: string[] = [];
      try {
        if (
          Number(
            db
              .prepare(
                "SELECT count(*) AS n FROM runs WHERE status IN ('running','steering')",
              )
              .get()?.n,
          )
        )
          blockers.push("Conversations or steering are still active.");
        const jobs = db
          .prepare(
            "SELECT * FROM coding_jobs WHERE status NOT IN ('completed','cancelled','failed','queued')",
          )
          .all();
        for (const j of jobs) {
          if (codingWorkUncertain(j))
            blockers.push(
              "A coding worker is active, missing, or uncertain; inspect it before retrying.",
            );
        }
        if (
          Number(
            db
              .prepare(
                "SELECT count(*) AS n FROM coding_job_inputs WHERE status IN ('launching','dispatching')",
              )
              .get()?.n,
          )
        )
          blockers.push("Coding submission is in flight.");
      } catch {
        blockers.push(
          "Work cannot be verified because its store is busy or unreadable.",
        );
      } finally {
        db.close();
      }
      if (await this.running()) {
        try {
          const result = await appProbe("/api/updates/quiescence");
          if (result.tasks || result.requests || result.login)
            blockers.push("Application tasks or requests are still finishing.");
          if (frozen && !result.frozen)
            blockers.push("Writer gate has not closed.");
        } catch {
          blockers.push("Application quiescence cannot be verified.");
        }
      }
      return [...new Set(blockers)];
    },
    async stop() {
      const before = await execute("/usr/bin/systemctl", [
        "show",
        unit,
        "--property=ControlGroup",
        "--value",
      ]);
      await control("stop");
      const values = await execute("/usr/bin/systemctl", [
        "show",
        unit,
        "--property=ActiveState,SubState,MainPID,ControlGroup",
      ]);
      if (
        !values.includes("ActiveState=inactive") ||
        !values.includes("MainPID=0")
      )
        throw new Error("Service did not stop cleanly.");
      const reported = values
        .split("\n")
        .find((s) => s.startsWith("ControlGroup="))
        ?.slice(13);
      const group = before || reported;
      if (group) {
        try {
          if (
            (
              await readFile(
                join("/sys/fs/cgroup", group, "cgroup.events"),
                "utf8",
              )
            ).includes("populated 1")
          )
            throw new Error("Service group still has writers.");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
    },
    async start() {
      await control("start");
    },
    async probe(version, id, tokenValue) {
      const contract = JSON.parse(
        await readFile(
          join(c.root, "releases", version, "compatibility.json"),
          "utf8",
        ),
      );
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        try {
          const result = await appProbe("/api/updates/probe");
          if (
            result.version === version &&
            result.operation === id &&
            result.token === tokenValue &&
            result.integrity === true &&
            result.appSchema === contract.app.output &&
            result.authSchema === contract.auth.output &&
            result.assets === true &&
            result.shell === true &&
            result.workerReady === true
          )
            return;
        } catch {
          /* Startup may still be in progress. */
        }
        await delay(500);
      }
      throw new Error("Candidate readiness deadline exceeded.");
    },
  };
}
