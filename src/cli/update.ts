import { cp, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { activate, readRelease } from "./releases";
import { activeRuns, maintenance } from "./state";

export type ServerControl = {
  isActive(): Promise<boolean>;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  healthy(version: string): Promise<void>;
};

// Both the release pointer and all agent data are restored before reopening the app.
export async function applyUpdate(
  root: string,
  previous: string,
  candidate: string,
  server: ServerControl,
  signal: AbortSignal,
) {
  const old = await readRelease(previous);
  const next = await readRelease(candidate);
  const running = await server.isActive();
  let backup: string | undefined;
  let switched = false;
  let recovered = true;
  maintenance(root, true);
  try {
    console.log(
      "Waiting for agent runs and coding jobs to finish (up to five minutes)…",
    );
    const deadline = Date.now() + 300000;
    while (running && activeRuns(root) > 0) {
      if (Date.now() > deadline)
        throw new Error(
          "Work or a resumable coding job is still active. Update cancelled; complete or stop coding jobs before retrying.",
        );
      await delay(500, undefined, { signal });
    }
    signal.throwIfAborted();
    await server.stop();
    const snapshot = join(root, "backups", `${old.version}-${Date.now()}`);
    await mkdir(dirname(snapshot), { recursive: true, mode: 0o700 });
    await cp(join(root, "data"), snapshot, {
      recursive: true,
      dereference: false,
    });
    backup = snapshot;
    signal.throwIfAborted();
    await activate(root, candidate);
    switched = true;
    await server.start();
    await server.healthy(next.version);
    signal.throwIfAborted();
    if (!running) await server.stop();
    console.log(`Updated to Roost ${next.version}. Backup: ${backup}`);
  } catch (error) {
    try {
      if (switched && backup) {
        await server.stop();
        await rename(
          join(root, "data"),
          join(root, `failed-update-${Date.now()}`),
        );
        await cp(backup, join(root, "data"), {
          recursive: true,
          dereference: false,
        });
        await activate(root, previous);
      }
      if (running) {
        await server.start();
        await server.healthy(old.version);
      }
      // Allow a clean retry of a failed candidate; keep failed data for diagnosis.
      await rm(candidate, { recursive: true, force: true });
    } catch (recoveryError) {
      recovered = false;
      throw new Error(
        `Update and recovery failed. Maintenance remains enabled. Backup: ${backup ?? "not taken"}. Inspect roost server logs before recovering.`,
        { cause: recoveryError },
      );
    }
    throw error;
  } finally {
    if (recovered) maintenance(root, false);
  }
}
