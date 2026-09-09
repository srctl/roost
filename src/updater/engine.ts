import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compareVersions } from "./contract";
import { openGate, readGate, writeGate } from "./gate";
import {
  durableJson,
  type Journal,
  type Phase,
  readJournal,
  syncDirectory,
  writeJournal,
} from "./journal";
import { withKernelLock } from "./lock";
import { assertOffer, type Offer } from "./releases";
import {
  createSnapshot,
  syncTree,
  verifyData,
  verifySnapshot,
} from "./snapshot";

export class SimulatedPowerLoss extends Error {}

export type Accepted = {
  actor: string;
  key: string;
  offer: Offer;
  confirmedVersion: string;
};
export type Operation = Journal & {
  request: Accepted;
  cancelRequested: boolean;
  committed: boolean;
  error?: string;
  blockers?: string[];
  bytes?: number;
  deadline?: number;
};
export const terminal = (phase: Phase) =>
  [
    "succeeded",
    "rolled-back",
    "failed",
    "deferred",
    "cancelled",
    "manual-recovery",
  ].includes(phase);
export type EngineAdapter = {
  running(): Promise<boolean>;
  stage(
    offer: Offer,
    id: string,
    signal: AbortSignal,
    progress: (bytes: number) => void,
  ): Promise<void>;
  preflight(candidate: string): Promise<void>;
  admission(blocked: boolean): Promise<void>;
  blockers(frozen: boolean): Promise<string[]>;
  stop(): Promise<void>; // Must return only after verifying the service group empty.
  start(): Promise<void>;
  probe(version: string, id: string, token: string): Promise<void>;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** One daemon owns the lock for the entire transaction. All crash recovery uses
 * durable intent records; filesystem observations can never invent a commit. */
export class UpdateEngine {
  private busy = false;
  private cancellationOpen = false;
  private cancelled = false;
  private cancellationWrite?: Promise<void>;
  private abort?: AbortController;
  private work?: Promise<void>;
  private current?: Operation;
  constructor(
    readonly root: string,
    readonly adapter: EngineAdapter,
    readonly drainMs = 300000,
    private readonly boundary: (
      phase: string,
    ) => Promise<void> = async () => {},
  ) {}
  async records() {
    await mkdir(join(this.root, "updates"), { recursive: true, mode: 0o700 });
    const records: Operation[] = [];
    for (const name of await readdir(join(this.root, "updates"))) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue;
      const value = (await readJournal(this.root, name)) as Operation;
      if (
        !value.request ||
        typeof value.request !== "object" ||
        typeof value.committed !== "boolean" ||
        !/^[a-f0-9]{64}$/.test(value.request.actor) ||
        !/^[a-zA-Z0-9_-]{16,100}$/.test(value.request.key) ||
        value.request.confirmedVersion !== value.candidate ||
        value.request.offer?.version !== value.candidate ||
        ((value.phase === "committed" || value.phase === "succeeded") &&
          !value.committed)
      )
        throw new Error("Incomplete operation evidence.");
      records.push(value);
    }
    return records.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async status(id?: string) {
    if (this.busy && this.current && (!id || id === this.current.id))
      return this.current;
    return (await this.records()).find((r) => !id || r.id === id) ?? null;
  }
  async checkpoint(phase: Phase, patch: Partial<Operation> = {}) {
    const record = {
      ...this.current!,
      ...patch,
      phase,
      sequence: this.current!.sequence + 1,
      updatedAt: Date.now(),
    };
    await this.boundary(`before-journal-${phase}`);
    await writeJournal(this.root, record);
    this.current = record;
    await this.boundary(phase);
  }
  async accept(request: Accepted): Promise<Operation> {
    request = { ...request, offer: { ...request.offer, notes: "" } };
    if (
      !/^[a-f0-9]{64}$/.test(request.actor) ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(request.key) ||
      request.confirmedVersion !== request.offer.version
    )
      throw new Error("Invalid update confirmation.");
    const existing = (await this.records()).find(
      (r) => r.request.key === request.key,
    );
    if (existing) {
      if (digest(existing.request) !== digest(request))
        throw new Error("Idempotency key conflicts with its accepted request.");
      return existing;
    }
    if (this.busy) throw new Error("Another update is active.");
    if (readGate(this.root).mode !== "open")
      throw new Error("Recovery gate is not open.");
    this.busy = true;
    let accept!: (value: Operation) => void;
    let reject!: (error: unknown) => void;
    const accepted = new Promise<Operation>((a, b) => {
      accept = a;
      reject = b;
    });
    this.work = withKernelLock(this.root, async () => {
      if (
        (await this.records()).some(
          (r) => !terminal(r.phase) || r.phase === "manual-recovery",
        )
      )
        throw new Error("Unresolved update requires recovery.");
      const previous = (await realpath(join(this.root, "current")))
        .split("/")
        .at(-1)!;
      assertOffer(request.offer, request.offer.id, previous);
      if (compareVersions(request.confirmedVersion, previous) <= 0)
        throw new Error("Version is not newer.");
      const id = randomUUID();
      this.cancellationOpen = true;
      this.cancelled = false;
      this.cancellationWrite = undefined;
      this.current = {
        protocol: 1,
        id,
        sequence: 1,
        phase: "accepted",
        previous,
        candidate: request.confirmedVersion,
        wasRunning: await this.adapter.running(),
        updatedAt: Date.now(),
        request,
        cancelRequested: false,
        committed: false,
      };
      await this.boundary("before-journal-accepted");
      try {
        await writeJournal(this.root, this.current);
      } catch (error) {
        await this.recordFailure(error);
        // A rename may have succeeded before fsync failed. Never acknowledge or
        // leave that operation looking like a running download: no work began.
        try {
          this.current = (await readJournal(this.root, id)) as Operation;
          await this.checkpoint("failed", {
            error: "Acceptance durability failed; no update was started.",
          });
        } catch {
          // Keep partial evidence for the operator. If storage cannot persist
          // even this gate, propagate the I/O failure; do not activate anything.
          await this.gate("manual");
        }
        throw error;
      }
      accept(this.current);
      await this.boundary("accepted");
      await this.run();
    })
      .catch(reject)
      .finally(() => {
        this.busy = false;
        this.abort = undefined;
      });
    return accepted;
  }
  async settled() {
    await this.work;
  }
  async cancel(id: string) {
    if (this.current?.id !== id || terminal(this.current.phase)) {
      const record = await this.status(id);
      if (!record) throw new Error("Unknown update operation.");
      return record;
    }
    if (this.cancellationWrite) {
      await this.cancellationWrite;
      return this.status(id);
    }
    if (
      !this.cancellationOpen ||
      !["accepted", "staged", "draining"].includes(this.current.phase)
    )
      throw new Error("Update can no longer be cancelled.");
    // Cancellation is serialized into the next engine checkpoint; a lost cancel
    // response is never evidence of cancellation. The signal only cancels staging.
    this.cancellationWrite = durableJson(
      join(this.root, "updates", id, "cancel.json"),
      { id, cancelled: true },
    ).then(() => {
      if (this.current?.id === id) {
        this.cancelled = true;
        this.current.cancelRequested = true;
        this.abort?.abort();
      }
    });
    await this.cancellationWrite;
    return this.current;
  }
  private async switchRelease(version: string) {
    const rollback = version === this.current!.previous;
    const temporary = join(this.root, `.update-current-${this.current!.id}`);
    await rm(temporary, { force: true });
    await symlink(join(this.root, "releases", version), temporary);
    await rename(temporary, join(this.root, "current"));
    await this.boundary(
      rollback
        ? "rollback-pointer-renamed-before-sync"
        : "pointer-renamed-before-sync",
    );
    await syncDirectory(this.root);
    await this.boundary(
      rollback ? "rollback-pointer-renamed" : "pointer-renamed",
    );
  }
  private async gate(
    mode: "drain" | "hold" | "verify" | "manual",
    version?: string,
  ) {
    const token =
      mode === "verify" ? randomBytes(32).toString("hex") : undefined;
    await writeGate(this.root, {
      protocol: 1,
      operation: this.current!.id,
      mode,
      version,
      token,
    });
    return token!;
  }
  private async open() {
    await this.adapter.admission(false);
    await writeGate(this.root, openGate);
    await this.boundary("admission-open");
  }
  private async verify(version: string) {
    await this.adapter.admission(true);
    const token = await this.gate("verify", version);
    await this.adapter.start();
    await this.boundary(
      version === this.current!.previous
        ? "rollback-service-started"
        : "service-started",
    );
    await this.adapter.probe(version, this.current!.id, token);
  }
  private async run() {
    this.abort = new AbortController();
    try {
      await this.adapter.stage(
        this.current!.request.offer,
        this.current!.id,
        this.abort.signal,
        (bytes) => {
          if (this.current) this.current.bytes = bytes;
        },
      );
      await this.adapter.preflight(this.current!.candidate);
      await this.checkpoint("staged");
      if (this.cancelled || this.current!.cancelRequested) {
        await this.checkpoint("cancelled");
        return;
      }
      await this.adapter.admission(true);
      await this.gate("drain");
      const deadline = Date.now() + this.drainMs;
      await this.checkpoint("draining", { deadline });
      while (true) {
        const blockers = await this.adapter.blockers(false);
        if (
          this.cancelled ||
          this.current!.cancelRequested ||
          Date.now() > deadline
        ) {
          await this.checkpoint(
            this.cancelled || this.current!.cancelRequested
              ? "cancelled"
              : "deferred",
            { blockers },
          );
          await this.open();
          return;
        }
        if (!blockers.length) break;
        this.current!.blockers = blockers;
        await delay(250);
      }
      this.cancellationOpen = false;
      await this.cancellationWrite?.catch(() => {});
      if (this.cancelled || this.current!.cancelRequested) {
        await this.checkpoint("cancelled");
        await this.open();
        return;
      }
      await this.gate("hold");
      // Freeze background writers, then wait for their already-started tasks and
      // in-flight requests. Never terminate work to satisfy the update deadline.
      while ((await this.adapter.blockers(true)).length) {
        if (Date.now() > deadline) {
          await this.checkpoint("deferred");
          await this.open();
          return;
        }
        await delay(100);
      }
      await this.checkpoint("stopping", { blockers: [] });
      await this.adapter.stop();
      await this.boundary("service-stopped");
      const stoppedBlockers = await this.adapter.blockers(true);
      if (stoppedBlockers.length) {
        // Shutdown can outlive a previously fresh external-worker observation.
        // Recheck after the service group is empty, before copying any data.
        if (this.current!.wasRunning) await this.verify(this.current!.previous);
        await this.checkpoint("deferred", {
          blockers: stoppedBlockers,
          error:
            "Work could not be verified after shutdown; the previous release was preserved.",
        });
        await this.open();
        return;
      }
      const snapshotDigest = await createSnapshot(this.root, this.current!.id);
      await durableJson(
        join(this.root, "updates", this.current!.id, "config.json"),
        JSON.parse(await readFile(join(this.root, "config.json"), "utf8")),
      );
      await this.checkpoint("snapshot-complete", { snapshotDigest });
      await this.checkpoint("activating");
      await this.switchRelease(this.current!.candidate);
      await this.checkpoint("verifying");
      await this.verify(this.current!.candidate);
      await this.checkpoint("committed", { committed: true });
      if (!this.current!.wasRunning) await this.adapter.stop();
      await this.open();
      await this.checkpoint("succeeded");
    } catch (error) {
      if (error instanceof SimulatedPowerLoss) throw error;
      await this.recordFailure(error);
      // Re-read: fsync/ack failure may follow a durable commit. Never roll back
      // because a caller lost the successful commit response.
      this.current = (await readJournal(
        this.root,
        this.current!.id,
      )) as Operation;
      this.current.cancelRequested ||= existsSync(
        join(this.root, "updates", this.current.id, "cancel.json"),
      );
      if (this.current.committed) {
        await this.manual();
        return;
      }
      if (
        [
          "accepted",
          "staged",
          "draining",
          "cancelled",
          "deferred",
          "failed",
        ].includes(this.current.phase)
      ) {
        await this.checkpoint(
          this.current.cancelRequested ? "cancelled" : "failed",
          { error: "Update preparation failed; serving release preserved." },
        );
        await this.open();
        return;
      }
      await this.recoverCurrent();
    }
  }
  private async recordFailure(error: unknown) {
    if (!this.current) return;
    try {
      await durableJson(
        join(this.root, "updates", this.current.id, "diagnostic.json"),
        {
          phase: this.current.phase,
          recordedAt: Date.now(),
          message: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 4096),
        },
      );
    } catch {
      // A storage fault can prevent diagnostics too. Existing journal/snapshot
      // evidence remains authoritative; logging must never interrupt recovery.
    }
  }
  private async manual() {
    await this.gate("manual");
    await this.checkpoint("manual-recovery", {
      error:
        "Automatic recovery could not be verified. Use roost updates status and retain all operation files.",
    });
  }
  private async restore() {
    const j = this.current!;
    await verifySnapshot(this.root, j.id, j.snapshotDigest!);
    const directory = join(this.root, "updates", j.id);
    const restore = join(directory, "restore");
    const failed = join(directory, "failed-data");
    // The original snapshot is immutable. A partial restore directory may be
    // discarded, but candidate data and the sole snapshot are never discarded.
    if (!existsSync(failed)) {
      await rm(restore, { recursive: true, force: true });
      await cp(join(directory, "snapshot"), restore, {
        recursive: true,
        preserveTimestamps: true,
        dereference: false,
      });
      await verifyData(restore, j.snapshotDigest!);
      await syncTree(restore);
      await rename(join(this.root, "data"), failed);
      await this.boundary("failed-data-renamed-before-sync");
      await syncDirectory(this.root);
      await syncDirectory(directory);
      await this.boundary("failed-data-renamed");
    }
    if (!existsSync(join(this.root, "data"))) {
      if (!existsSync(restore)) {
        await cp(join(directory, "snapshot"), restore, {
          recursive: true,
          preserveTimestamps: true,
          dereference: false,
        });
        await syncTree(restore);
      }
      await verifyData(restore, j.snapshotDigest!);
      await rename(restore, join(this.root, "data"));
      await this.boundary("restored-data-renamed-before-sync");
      await syncDirectory(this.root);
      await syncDirectory(directory);
      await this.boundary("restored-data-renamed");
    } else await verifyData(join(this.root, "data"), j.snapshotDigest!);
    await this.switchRelease(j.previous);
  }
  private async recoverCurrent() {
    try {
      const j = this.current!;
      const actual = await realpath(join(this.root, "current"));
      if (
        ![j.previous, j.candidate].some(
          (v) => actual === join(this.root, "releases", v),
        )
      )
        throw new Error("Unexpected release pointer.");
      if (j.committed) {
        if (actual !== join(this.root, "releases", j.candidate))
          throw new Error("Committed pointer changed.");
        await this.verify(j.candidate);
        if (!j.wasRunning) await this.adapter.stop();
        await this.open();
        await this.checkpoint("succeeded", { error: undefined, blockers: [] });
        return;
      }
      await this.gate("hold");
      await this.adapter.stop();
      if (j.snapshotDigest) {
        await this.checkpoint("restoring");
        await this.restore();
      } else if (actual !== join(this.root, "releases", j.previous))
        throw new Error("Activation without snapshot.");
      await this.verify(j.previous);
      if (!j.wasRunning) await this.adapter.stop();
      if (j.snapshotDigest)
        await this.checkpoint("rolled-back", {
          error:
            "Candidate did not pass startup checks. Previous release and data restored.",
        });
      else await this.checkpoint("cancelled");
      await this.open();
    } catch (error) {
      if (error instanceof SimulatedPowerLoss) throw error;
      await this.recordFailure(error);
      await this.manual();
    }
  }
  async repair(id: string, decision: "restore" | "resume", version: string) {
    if (this.busy) throw new Error("Updater is busy.");
    return withKernelLock(this.root, async () => {
      const record = (await this.records()).find((r) => r.id === id);
      if (record?.phase !== "manual-recovery")
        throw new Error("Select a manual-recovery operation.");
      if (
        record.committed
          ? decision !== "resume" || version !== record.candidate
          : decision !== "restore" || version !== record.previous
      )
        throw new Error(
          "Repair decision does not match the durable commit/version.",
        );
      this.current = record;
      await this.recoverCurrent();
      return this.current;
    });
  }
  async recover() {
    if (this.busy) throw new Error("Updater is busy.");
    return withKernelLock(this.root, async () => {
      const records = await this.records();
      const gate = readGate(this.root);
      if (
        gate.operation &&
        /^[a-f0-9-]{36}$/.test(gate.operation) &&
        !records.some((r) => r.id === gate.operation)
      )
        throw new Error("Gate refers to a missing operation journal.");
      const unresolved = records.filter(
        (r) => !terminal(r.phase) || r.phase === "manual-recovery",
      );
      if (unresolved.length > 1)
        throw new Error(
          "Multiple unresolved updates; manual recovery required.",
        );
      this.current = unresolved[0] ?? records[0];
      if (!this.current) {
        await writeGate(this.root, openGate);
        return;
      }
      if (this.current.phase === "manual-recovery") {
        await this.gate("manual");
        return;
      }
      if (terminal(this.current.phase)) {
        const expected = this.current.committed
          ? this.current.candidate
          : this.current.previous;
        if (
          (await realpath(join(this.root, "current"))) !==
          join(this.root, "releases", expected)
        ) {
          await this.manual();
          return;
        }
        await this.open();
        return;
      }
      if (
        [
          "accepted",
          "staged",
          "draining",
          "cancelled",
          "deferred",
          "failed",
        ].includes(this.current.phase)
      ) {
        if (
          (await realpath(join(this.root, "current"))) !==
          join(this.root, "releases", this.current.previous)
        ) {
          await this.manual();
          return;
        }
        if (this.current.wasRunning && !(await this.adapter.running()))
          await this.verify(this.current.previous);
        await this.checkpoint("failed", {
          error: "Preparation interrupted; update was not retried.",
        });
        await this.open();
        return;
      }
      await this.recoverCurrent();
    });
  }
}
