import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { type Operation, terminal, UpdateEngine } from "./engine";
import { readEnrollment, validateInstallation } from "./enrollment";
import { openGate, readGate, writeGate } from "./gate";
import { durableJson } from "./journal";
import { withKernelLock } from "./lock";
import { execute } from "./process";
import { type Offer, ReleaseChecker } from "./releases";
import { systemdAdapter } from "./systemd";

export function summary(record: Operation | null) {
  return record
    ? {
        id: record.id,
        requestKey: record.request.key,
        phase: record.phase,
        previous: record.previous,
        version: record.candidate,
        updatedAt: record.updatedAt,
        cancellable: ["accepted", "staged", "draining"].includes(record.phase),
        error: record.error,
        blockers: record.blockers,
        bytes: record.bytes,
        committed: record.committed,
      }
    : null;
}
export type UpdateSummary = NonNullable<ReturnType<typeof summary>>;
export async function serveUpdater(root: string, support: string) {
  const mainPid = await execute(
    "/usr/bin/systemctl",
    [
      "show",
      `roost-${process.getuid?.()}-updater.service`,
      "--property=MainPID",
      "--value",
    ],
    10000,
  );
  if (mainPid !== String(process.pid))
    throw new Error("Run the updater through its enrolled systemd supervisor.");
  // A second manual/service invocation must not close another helper's gate or
  // replace its live socket. This lifetime lock is separate from transaction ownership.
  return withKernelLock(root, () => supervise(root, support), "supervisor");
}
async function supervise(root: string, support: string) {
  const enrollment = await readEnrollment(root);
  await validateInstallation(enrollment.installation, true);
  const tokenPath = join(root, "updates", "github-token");
  let token: string | undefined;
  try {
    const info = await lstat(tokenPath);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      info.mode & 0o077 ||
      info.size > 1024
    )
      throw new Error("Updater credential must be an owner-only regular file.");
    token = (await readFile(tokenPath, "utf8")).trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const adapter = systemdAdapter(enrollment.installation, support, token);
  const engine = new UpdateEngine(root, adapter);
  const priorGate = readGate(root);
  await writeGate(root, {
    ...openGate,
    mode: "hold",
    operation: priorGate.operation ?? "boot",
  });
  await durableJson(join(root, "updates", "ready.json"), {
    boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  });
  try {
    if (priorGate.mode === "manual" && !priorGate.operation)
      throw new Error("Missing or corrupt gate evidence.");
    await engine.recover();
  } catch {
    await writeGate(root, { ...openGate, mode: "manual", operation: "boot" });
  }
  const checker = new ReleaseChecker(
    enrollment.installation.repository!,
    fetch,
    token,
  );
  let offer: Offer | undefined;
  try {
    offer = JSON.parse(
      await readFile(join(root, "updates", "offer.json"), "utf8"),
    );
  } catch {
    /* A missing offer is never permission to activate. */
  }
  const handle = async (message: Record<string, unknown>) => {
    if (message.protocol !== 1 || typeof message.action !== "string")
      throw new Error("Unsupported updater protocol.");
    const fields: Record<string, string[]> = {
      status: ["id", "key", "actor"],
      check: [],
      accept: ["offerId", "version", "actor", "key"],
      cancel: ["id"],
      start: [],
      stop: [],
      repair: ["id", "decision", "version"],
    };
    if (
      !fields[message.action] ||
      Object.keys(message).some(
        (key) =>
          ![
            "protocol",
            "action",
            ...fields[message.action as string]!,
          ].includes(key),
      )
    )
      throw new Error("Unexpected updater request fields.");
    if (message.action === "status") {
      // Authenticated owner reads may reconcile a key after native reauth.
      // This grants no mutation authority; accept still checks the original actor.
      const record = message.key
        ? ((await engine.records()).find(
            (r) =>
              r.request.key === message.key &&
              (message.actor === undefined ||
                r.request.actor === message.actor),
          ) ?? null)
        : await engine.status(
            typeof message.id === "string" ? message.id : undefined,
          );
      return {
        protocol: 1,
        qualified: true,
        latest: offer ?? null,
        operation: summary(record),
      };
    }
    if (message.action === "check") {
      offer = await checker.check();
      await durableJson(join(root, "updates", "offer.json"), offer);
      return offer;
    }
    if (message.action === "accept") {
      const existing = (await engine.records()).find(
        (r) => r.request.key === message.key,
      );
      if (existing) {
        if (
          existing.request.actor !== message.actor ||
          existing.request.offer.id !== message.offerId ||
          existing.candidate !== message.version
        )
          throw new Error("Idempotency conflict.");
        return summary(existing);
      }
      if (
        !offer ||
        offer.id !== message.offerId ||
        typeof message.actor !== "string" ||
        typeof message.key !== "string" ||
        typeof message.version !== "string"
      )
        throw new Error("Check releases and confirm the offered version.");
      return summary(
        await engine.accept({
          actor: message.actor,
          key: message.key,
          offer,
          confirmedVersion: message.version,
        }),
      );
    }
    if (message.action === "repair") {
      if (
        typeof message.id !== "string" ||
        typeof message.version !== "string" ||
        !["restore", "resume"].includes(String(message.decision))
      )
        throw new Error("Invalid repair confirmation.");
      return summary(
        await engine.repair(
          message.id,
          message.decision as "restore" | "resume",
          message.version,
        ),
      );
    }
    if (message.action === "cancel") {
      if (typeof message.id !== "string")
        throw new Error("Missing operation ID.");
      return summary(await engine.cancel(message.id));
    }
    return withKernelLock(root, async () => {
      const latest = await engine.status();
      if (
        latest &&
        (!terminal(latest.phase) || latest.phase === "manual-recovery")
      )
        throw new Error("Resolve the active update first.");
      if (message.action === "start") await adapter.start();
      else await adapter.stop();
      return { ok: true };
    });
  };
  const child = spawn(
    "/usr/bin/python3",
    [join(support, "peer-broker.py"), join(root, "updates", "helper.sock")],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    if (line.length > 16384) {
      child.kill();
      throw new Error("Invalid socket bridge frame.");
    }
    const envelope = JSON.parse(line) as {
      ready?: boolean;
      id: string;
      message: Record<string, unknown>;
    };
    if (envelope.ready) continue;
    // Requests may observe/cancel an operation while its long transaction runs.
    void handle(envelope.message)
      .then(
        (value) => ({ value }),
        () => ({
          error:
            "Updater request refused. Check enrollment, confirmation and durable status.",
        }),
      )
      .then((result) => {
        if (child.stdin.writable)
          child.stdin.write(`${JSON.stringify({ id: envelope.id, result })}\n`);
      });
  }
  throw new Error("Updater socket bridge stopped.");
}
