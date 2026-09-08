import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
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
  for (const phase of ["failed-data-renamed", "restored-data-renamed"]) {
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
