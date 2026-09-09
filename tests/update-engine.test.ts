import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mock, test } from "node:test";
import { activate } from "../src/cli/releases";
import { maintenance } from "../src/cli/state";
import {
  type EngineAdapter,
  SimulatedPowerLoss,
  UpdateEngine,
} from "../src/updater/engine";
import { enrollmentFiles } from "../src/updater/enrollment";
import { readGate } from "../src/updater/gate";
import { parseOffer } from "../src/updater/releases";

async function fixture(
  run: (
    root: string,
    adapter: EngineAdapter,
    control: { fail: boolean; busy: boolean; running: boolean; stops: number },
  ) => Promise<void>,
) {
  const root = await mkdtemp("/tmp/roost-engine-");
  await mkdir(join(root, "data"), { mode: 0o700 });
  await mkdir(join(root, "releases", "0.1.40"), { recursive: true });
  await mkdir(join(root, "releases", "0.2.0"));
  await activate(root, join(root, "releases", "0.1.40"));
  await writeFile(join(root, "config.json"), JSON.stringify({ root }), {
    mode: 0o600,
  });
  for (const name of ["roost.sqlite", "auth.sqlite"]) {
    const db = new DatabaseSync(join(root, "data", name));
    db.exec(
      "CREATE TABLE data(value TEXT); INSERT INTO data VALUES('old'); CREATE TABLE runtime_control(id INTEGER, maintenance INTEGER); INSERT INTO runtime_control VALUES(1,0)",
    );
    db.close();
    await chmod(join(root, "data", name), 0o600);
  }
  await writeFile(join(root, "data", "secret"), "original", { mode: 0o600 });
  const control = { fail: false, busy: false, running: true, stops: 0 };
  const adapter: EngineAdapter = {
    running: async () => control.running,
    stage: async (_offer, _id, signal, progress) => {
      signal.throwIfAborted();
      progress(123);
    },
    preflight: async () => {},
    admission: async (blocked) => maintenance(root, blocked),
    blockers: async () => (control.busy ? ["uncertain worker"] : []),
    stop: async () => {
      control.stops++;
      control.running = false;
    },
    start: async () => {
      control.running = true;
    },
    probe: async (version, id, token) => {
      const db = new DatabaseSync(join(root, "data", "roost.sqlite"), {
        readOnly: true,
      });
      assert.equal(
        db.prepare("SELECT maintenance FROM runtime_control WHERE id=1").get()
          ?.maintenance,
        1,
      );
      db.close();
      assert.equal(readGate(root).mode, "verify");
      assert.equal(readGate(root).token, token);
      assert.equal(readGate(root).operation, id);
      if (version === "0.2.0") {
        await writeFile(join(root, "data", "secret"), "candidate");
        if (control.fail) throw new Error("bad startup");
      }
    },
  };
  try {
    await run(root, adapter, control);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function request() {
  const offer = parseOffer(
    {
      id: 1,
      tag_name: "v0.2.0",
      draft: false,
      prerelease: false,
      assets: [
        {
          id: 2,
          name: "roost-linux-x64.tar.gz",
          digest: `sha256:${"a".repeat(64)}`,
          size: 123,
          url: "https://api.github.com/repos/srctl/roost/releases/assets/2",
        },
      ],
    },
    "srctl/roost",
    Date.now(),
  );
  return {
    actor: "b".repeat(64),
    key: randomUUID(),
    offer,
    confirmedVersion: offer.version,
  };
}

test("full engine commits once, preserves candidate data, and keeps prior stopped state", async () => {
  for (const running of [true, false])
    await fixture(async (root, adapter, c) => {
      c.running = running;
      const engine = new UpdateEngine(root, adapter);
      const input = request();
      const accepted = await engine.accept(input);
      await engine.settled();
      assert.equal((await engine.status())?.phase, "succeeded");
      assert.equal(
        await realpath(join(root, "current")),
        join(root, "releases", "0.2.0"),
      );
      assert.equal(
        await readFile(join(root, "data", "secret"), "utf8"),
        "candidate",
      );
      assert.equal(c.running, running);
      assert.equal(readGate(root).mode, "open");
      assert.equal((await engine.accept(input)).id, accepted.id);
      await assert.rejects(
        engine.accept({ ...input, confirmedVersion: "0.3.0" }),
      );
    });
});
test("startup failure restores matching data/release and preserves failed evidence", async () =>
  fixture(async (root, adapter, c) => {
    c.fail = true;
    const engine = new UpdateEngine(root, adapter);
    const accepted = await engine.accept(request());
    await engine.settled();
    assert.equal((await engine.status())?.phase, "rolled-back");
    const diagnostic = JSON.parse(
      await readFile(
        join(root, "updates", accepted.id, "diagnostic.json"),
        "utf8",
      ),
    );
    assert.equal(diagnostic.message, "bad startup");
    assert.doesNotMatch((await engine.status())!.error!, /bad startup/);
    assert.equal(
      await realpath(join(root, "current")),
      join(root, "releases", "0.1.40"),
    );
    assert.equal(
      await readFile(join(root, "data", "secret"), "utf8"),
      "original",
    );
    assert.equal(
      await readFile(
        join(root, "updates", accepted.id, "failed-data", "secret"),
        "utf8",
      ),
      "candidate",
    );
    assert.equal(readGate(root).mode, "open");
  }));
test("busy/uncertain work defers without stopping or replay; cancellation is durable", async () =>
  fixture(async (root, adapter, c) => {
    c.busy = true;
    const engine = new UpdateEngine(root, adapter, 10);
    await engine.accept(request());
    await engine.settled();
    assert.equal((await engine.status())?.phase, "deferred");
    assert.equal(c.stops, 0);
    assert.equal(readGate(root).mode, "open");
    const next = new UpdateEngine(root, adapter, 5000);
    const op = await next.accept(request());
    await Promise.all([next.cancel(op.id), next.cancel(op.id)]);
    await assert.rejects(next.cancel(randomUUID()), /Unknown/);
    await next.settled();
    assert.equal((await next.status())?.phase, "cancelled");
    assert.equal(c.stops, 0);
    assert.ok(await readFile(join(root, "updates", op.id, "cancel.json")));
  }));
test("simulated power loss at intent and rename boundaries recovers deterministically", async () => {
  for (const phase of [
    "accepted",
    "staged",
    "draining",
    "stopping",
    "service-stopped",
    "snapshot-complete",
    "activating",
    "pointer-renamed-before-sync",
    "pointer-renamed",
    "verifying",
    "service-started",
    "committed",
    "admission-open",
    "before-journal-staged",
    "before-journal-draining",
    "before-journal-stopping",
    "before-journal-snapshot-complete",
    "before-journal-activating",
    "before-journal-verifying",
    "before-journal-committed",
    "before-journal-succeeded",
  ]) {
    await fixture(async (root, adapter, _c) => {
      let tripped = false;
      const engine = new UpdateEngine(root, adapter, 1000, async (point) => {
        if (!tripped && point === phase) {
          tripped = true;
          throw new SimulatedPowerLoss();
        }
      });
      await engine.accept(request());
      await engine.settled();
      assert.ok(tripped, phase);
      const recovery = new UpdateEngine(root, adapter);
      await recovery.recover();
      const committed = [
        "committed",
        "admission-open",
        "before-journal-succeeded",
      ].includes(phase);
      assert.equal(
        await realpath(join(root, "current")),
        join(root, "releases", committed ? "0.2.0" : "0.1.40"),
        phase,
      );
      assert.equal(readGate(root).mode, "open", phase);
      assert.equal(
        await readFile(join(root, "data", "secret"), "utf8"),
        committed ? "candidate" : "original",
        phase,
      );
    });
  }
});
test("interrupted rollback resumes rename boundaries without overwriting failed data", async () => {
  for (const phase of [
    "failed-data-renamed-before-sync",
    "failed-data-renamed",
    "restored-data-renamed-before-sync",
    "restored-data-renamed",
    "rollback-pointer-renamed-before-sync",
    "rollback-pointer-renamed",
    "rollback-service-started",
  ]) {
    await fixture(async (root, adapter, c) => {
      c.fail = true;
      let tripped = false;
      const engine = new UpdateEngine(root, adapter, 1000, async (point) => {
        if (point === phase && !tripped) {
          tripped = true;
          throw new SimulatedPowerLoss();
        }
      });
      const op = await engine.accept(request());
      await engine.settled();
      assert.ok(tripped);
      await new UpdateEngine(root, adapter).recover();
      assert.equal(
        await readFile(join(root, "data", "secret"), "utf8"),
        "original",
      );
      assert.equal(
        await readFile(
          join(root, "updates", op.id, "failed-data", "secret"),
          "utf8",
        ),
        "candidate",
      );
    });
  }
});
test("corrupt complete snapshot fails closed and never pairs old code with candidate data", async () =>
  fixture(async (root, adapter, _c) => {
    const engine = new UpdateEngine(root, adapter, 1000, async (phase) => {
      if (phase === "verifying") throw new SimulatedPowerLoss();
    });
    const op = await engine.accept(request());
    await engine.settled();
    await writeFile(
      join(root, "updates", op.id, "snapshot", "secret"),
      "corrupt",
    );
    await new UpdateEngine(root, adapter).recover();
    assert.equal(readGate(root).mode, "manual");
    assert.equal(
      await realpath(join(root, "current")),
      join(root, "releases", "0.2.0"),
    );
  }));
test("enrollment policy grants only fixed-unit start/stop and pins helper outside current", () => {
  const files = enrollmentFiles(
    {
      root: "/home/roost/install",
      home: "/home/roost",
      user: "roost",
      uid: 1000,
      port: 3000,
    },
    "0.2.0",
  );
  assert.match(
    files.policy,
    /NOPASSWD: \/usr\/bin\/systemctl start roost-1000.service, \/usr\/bin\/systemctl stop roost-1000.service/,
  );
  assert.doesNotMatch(files.policy, /\*/);
  assert.match(files.unit, /releases\/0.2.0\/runtime\/node/);
  assert.doesNotMatch(files.unit, /current/);
  assert.match(files.dropin, /After=roost-1000-updater.service/);
  assert.doesNotMatch(files.dropin, /EnvironmentFile|start.env/);
});

test("post-commit failure never restores data and repair only resumes the committed candidate", async () =>
  fixture(async (root, adapter, _c) => {
    let interrupted = false;
    const engine = new UpdateEngine(root, adapter, 1000, async (phase) => {
      if (phase === "admission-open" && !interrupted) {
        interrupted = true;
        await writeFile(join(root, "data", "secret"), "new work after commit");
        throw new Error("lost commit acknowledgement");
      }
    });
    const op = await engine.accept(request());
    await engine.settled();
    assert.equal((await engine.status())?.phase, "manual-recovery");
    assert.equal((await engine.status())?.committed, true);
    await assert.rejects(engine.repair(op.id, "restore", "0.1.40"));
    adapter.probe = async () => {};
    await engine.repair(op.id, "resume", "0.2.0");
    assert.equal((await engine.status())?.phase, "succeeded");
    assert.equal((await engine.status())?.error, undefined);
    assert.equal(
      await readFile(join(root, "data", "secret"), "utf8"),
      "new work after commit",
    );
  }));

test("concurrent UI/CLI engine owners cannot both accept or stop work", async () =>
  fixture(async (root, adapter, control) => {
    control.busy = true;
    const one = new UpdateEngine(root, adapter, 10000);
    const two = new UpdateEngine(root, adapter, 10000);
    const first = request(),
      second = request();
    const results = await Promise.allSettled([
      one.accept(first),
      two.accept(second),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const winner = results[0]!.status === "fulfilled" ? one : two;
    const op = await winner.status();
    await winner.cancel(op!.id);
    await winner.settled();
    assert.equal(control.stops, 0);
  }));

test("storage failures preserve a recoverable pair and never claim a commit", async () => {
  for (const fault of [
    "bytes",
    "inodes",
    "snapshot-copy",
    "snapshot-fsync",
    "restore-copy",
    "restore-fsync",
  ])
    await fixture(async (root, adapter, control) => {
      let injected = 0;
      control.fail = fault.startsWith("restore");
      const cp = fs.cp;
      const open = fs.open;
      const statfs = fs.statfs;
      if (fault === "bytes" || fault === "inodes")
        mock.method(
          fs,
          "statfs",
          async (...args: Parameters<typeof statfs>) => {
            const result = await statfs(...args);
            injected++;
            return {
              ...result,
              ...(fault === "bytes" ? { bavail: 0n } : { ffree: 0n }),
            };
          },
        );
      if (fault.endsWith("copy"))
        mock.method(fs, "cp", async (...args: Parameters<typeof cp>) => {
          if (
            String(args[1]).includes(
              fault.startsWith("restore") ? "/restore" : "/snapshot/",
            )
          ) {
            injected++;
            throw Object.assign(new Error("Injected copy I/O failure"), {
              code: "EIO",
            });
          }
          return cp(...args);
        });
      if (fault.endsWith("fsync"))
        mock.method(fs, "open", async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          if (
            String(args[0]).includes(
              fault.startsWith("restore") ? "/restore/" : "/snapshot/",
            )
          )
            handle.sync = async () => {
              injected++;
              throw Object.assign(new Error("Injected fsync I/O failure"), {
                code: "EIO",
              });
            };
          return handle;
        });
      syncBuiltinESMExports();
      const engine = new UpdateEngine(root, adapter);
      try {
        await engine.accept(request());
        await engine.settled();
        assert.ok(injected > 0, `Fault must actually be reached: ${fault}`);
        assert.equal((await engine.status())?.committed, false);
        if (fault.startsWith("restore")) {
          assert.equal((await engine.status())?.phase, "manual-recovery");
          assert.equal(readGate(root).mode, "manual");
          const operation = (await engine.status())!;
          assert.equal(
            await readFile(
              join(root, "updates", operation.id, "snapshot", "secret"),
              "utf8",
            ),
            "original",
          );
        } else {
          assert.equal(
            await realpath(join(root, "current")),
            join(root, "releases", "0.1.40"),
          );
          assert.equal(
            await readFile(join(root, "data", "secret"), "utf8"),
            "original",
          );
        }
      } finally {
        mock.restoreAll();
        syncBuiltinESMExports();
      }
      if (fault.startsWith("restore")) {
        const operation = (await engine.status())!;
        await engine.repair(operation.id, "restore", "0.1.40");
        assert.equal((await engine.status())?.phase, "rolled-back");
        assert.equal(
          await readFile(join(root, "data", "secret"), "utf8"),
          "original",
        );
      }
    });
});

test("failed rollback startup holds the restored pair for explicit repair", async () =>
  fixture(async (root, adapter) => {
    const probe = adapter.probe;
    adapter.probe = async () => {
      throw new Error("Both releases fail their startup probes");
    };
    const engine = new UpdateEngine(root, adapter);
    const operation = await engine.accept(request());
    await engine.settled();
    assert.equal((await engine.status())?.phase, "manual-recovery");
    assert.equal(readGate(root).mode, "manual");
    assert.equal(
      await realpath(join(root, "current")),
      join(root, "releases", "0.1.40"),
    );
    assert.equal(
      await readFile(join(root, "data", "secret"), "utf8"),
      "original",
    );
    adapter.probe = probe;
    await engine.repair(operation.id, "restore", "0.1.40");
    assert.equal((await engine.status())?.phase, "rolled-back");
  }));

test("interruption before durable acceptance does not acknowledge or invent an operation", async () =>
  fixture(async (root, adapter, control) => {
    let reached = false;
    const engine = new UpdateEngine(root, adapter, 1000, async (phase) => {
      if (phase === "before-journal-accepted") {
        reached = true;
        throw new SimulatedPowerLoss();
      }
    });
    await assert.rejects(engine.accept(request()), SimulatedPowerLoss);
    await engine.settled();
    assert.equal(reached, true);
    assert.equal((await engine.records()).length, 0);
    await new UpdateEngine(root, adapter).recover();
    assert.equal(control.stops, 0);
    assert.equal(readGate(root).mode, "open");
  }));

test("acceptance fsync failure after rename is not acknowledged or left falsely running", async () =>
  fixture(async (root, adapter, control) => {
    const open = fs.open;
    let injected = false;
    mock.method(fs, "open", async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      const path = String(args[0]);
      if (!injected && /\/updates\/[a-f0-9-]{36}$/.test(path)) {
        const sync = handle.sync.bind(handle);
        handle.sync = async () => {
          if (!injected) {
            injected = true;
            throw Object.assign(new Error("Injected directory fsync failure"), {
              code: "EIO",
            });
          }
          return sync();
        };
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      const engine = new UpdateEngine(root, adapter);
      await assert.rejects(engine.accept(request()), /fsync failure/);
      await engine.settled();
      assert.equal(injected, true);
      assert.equal((await engine.status())?.phase, "failed");
      assert.equal(control.stops, 0);
      assert.equal(
        await realpath(join(root, "current")),
        join(root, "releases", "0.1.40"),
      );
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
    }
  }));

test("work becoming uncertain during shutdown defers before snapshot or activation", async () =>
  fixture(async (root, adapter, control) => {
    const stop = adapter.stop;
    adapter.stop = async () => {
      await stop();
      control.busy = true;
    };
    const engine = new UpdateEngine(root, adapter);
    const operation = await engine.accept(request());
    await engine.settled();
    assert.equal((await engine.status())?.phase, "deferred");
    assert.equal(control.running, true);
    assert.equal((await engine.status())?.committed, false);
    await assert.rejects(
      readFile(join(root, "updates", operation.id, "snapshot.json")),
    );
    assert.equal(
      await realpath(join(root, "current")),
      join(root, "releases", "0.1.40"),
    );
    assert.equal(readGate(root).mode, "open");
  }));
