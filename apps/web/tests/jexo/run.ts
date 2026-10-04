import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import type { JexoTest } from "jexo";
import { chromium } from "playwright";
import { saveAgent } from "../../src/server/agents/store.server";
import { originalName } from "./support";

// Jexo is private and unpublished. Its internal runner is needed for the free
// scripted chooser; fail explicitly if that development API moves.
const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../..");
const checkout = process.env.JEXO_CHECKOUT;
assert.ok(checkout, "Set JEXO_CHECKOUT to the built local jt/Jexo checkout");
const moduleAt = (file: string) =>
  import(pathToFileURL(join(checkout, file)).href);
// tsx adds a function-name helper that is unavailable inside page.evaluate.
// Bundle the runner with Bun, as Jexo's own CLI does, before loading it.
const compiled = join(here, ".runner");
const build = spawnSync(
  "bun",
  [
    "build",
    join(checkout, "src/core/runner.ts"),
    "--target=node",
    "--format=esm",
    "--packages=external",
    "--outdir",
    compiled,
  ],
  { encoding: "utf8" },
);
assert.equal(build.status, 0, build.stderr || "Could not bundle Jexo runner");
const { runTest } = await import(
  pathToFileURL(join(compiled, "runner.js")).href
);
const { discoverTests, loadTest } = await moduleAt("src/core/definition.ts");
const { createJevChooser } = await moduleAt("src/choosers/jev.ts");
const { createJevVerifier } = await moduleAt("src/choosers/verification.ts");

function expectedAction(description: string) {
  if (description === "Type the declared name into Display name") {
    return { kind: "fill", name: "Display name", inputName: "name" };
  }
  assert.ok(
    description.startsWith("Click "),
    `Unsupported offline step: ${description}`,
  );
  return { kind: "click", name: description.slice(6) };
}

const scriptedVerifier = {
  async verify(input: {
    kind: string;
    requirement: string;
    afterActionIndex: number;
    history: Array<{
      kind: string;
      target: { name: string };
      inputName?: string;
    }>;
  }) {
    assert.equal(
      input.kind,
      "step",
      "Offline mode supports scripted steps and code checks only",
    );
    const expected = expectedAction(input.requirement);
    const index = input.history.findIndex(
      (action, index) =>
        index + 1 > input.afterActionIndex &&
        action.kind === expected.kind &&
        action.target.name === expected.name &&
        (expected.kind !== "fill" || action.inputName === "name"),
    );
    return {
      status: index >= 0 ? "passed" : "failed",
      ...(index >= 0 ? { actionIndex: index + 1 } : {}),
      message:
        index >= 0
          ? "Offline scripted verification matched the observed action after the previous checkpoint; Jev was not called"
          : "Required action missing after the previous checkpoint",
      meta: { by: "script", durationMs: 0 },
    };
  },
};
const live = !process.argv.includes("--offline");
if (live) {
  assert.ok(
    process.env.TYPESAFE_API_KEY,
    "Jev execution requires TYPESAFE_API_KEY; --offline is an explicit scripted diagnostic mode",
  );
}
assert.ok(
  existsSync(join(web, ".output/server/index.mjs")),
  "Build Roost first",
);
const directory = mkdtempSync(join(tmpdir(), "roost-jexo-"));
const previousData = process.env.ROOST_DATA_DIR;
const previousUrl = process.env.ROOST_JEXO_START_URL;
process.env.ROOST_DATA_DIR = directory;
writeFileSync(
  join(directory, "auth.json"),
  JSON.stringify({ OPENAI_API_KEY: "fixture" }),
);
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>((done) => probe.close(() => done()));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  cwd: web,
  env: {
    PATH: process.env.PATH,
    TMPDIR: tmpdir(),
    ROOST_DATA_DIR: directory,
    ROOST_CODEX_BINARY: join(web, "tests/fixtures/chat-server.mjs"),
    HOST: "127.0.0.1",
    PORT: String(port),
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (chunk) => {
  logs += chunk;
});
server.stderr.on("data", (chunk) => {
  logs += chunk;
});
const output = resolve(
  process.env.ROOST_JEXO_RUNS ?? join(web, "output/playwright/jexo"),
);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ready = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(1000),
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) break;
    if (attempt === 199 || server.exitCode !== null)
      throw new Error(logs || "Local Roost server did not start");
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({
    headless: !process.argv.includes("--headed"),
    executablePath: process.env.ROOST_TEST_CHROME || undefined,
  });
  const createContext = browser.newContext.bind(browser);
  const browserErrors: string[] = [];
  let activeTest: JexoTest;
  let actionCursor = 0;
  browser.newContext = async (options) => {
    const context = await createContext({
      ...options,
      reducedMotion: "reduce",
    });
    // Fixture UI only: even accidental third-party browser requests are blocked.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
    context.on("page", (page) => {
      page.on("pageerror", (error) => browserErrors.push(error.message));
      const navigate = page.goto.bind(page);
      page.goto = async (...args) => {
        const response = await navigate(...args);
        // SSR controls appear before React can respond to a click.
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll("button")).some((button) =>
            Object.keys(button).some((key) => key.startsWith("__reactProps$")),
          ),
        );
        return response;
      };
      const waitForLoad = page.waitForLoadState.bind(page);
      page.waitForLoadState = async (...args) => {
        await waitForLoad(...args);
        // The offline chooser runs faster than a human/model. Wait for its
        // known fixture transitions; live Jev must choose its own route.
        if (live) return;
        const completed = activeTest.requiredSteps?.[actionCursor++];
        if (completed?.description === "Click Save") {
          if (activeTest.name === "Reject a blank agent name")
            await page
              .getByRole("alert")
              .filter({ hasText: "between 1 and 60" })
              .waitFor();
          else
            await page
              .getByRole("status")
              .filter({ hasText: "Display name saved." })
              .waitFor();
        }
        const next = activeTest.requiredSteps?.[actionCursor];
        if (next) {
          const expected = expectedAction(next.description);
          await page
            .getByRole(expected.kind === "fill" ? "textbox" : "button", {
              name: expected.name,
              exact: true,
            })
            .waitFor();
        }
      };
    });
    return context;
  };
  const summaries = [];
  for (const file of await discoverTests(here)) {
    const id = randomUUID();
    await Effect.runPromise(
      saveAgent({
        id,
        name: originalName,
        instructions: "Disposable Jexo fixture. No external actions.",
        character: "moss",
        model: "fake",
      }),
    );
    process.env.ROOST_JEXO_START_URL = `${base}/agents/${id}`;
    const loaded = await loadTest(file);
    activeTest = loaded.test;
    actionCursor = 0;
    let cursor = 0;
    const chooser = live
      ? createJevChooser()
      : {
          async choose(input: {
            actions: Array<{
              id: string;
              kind: string;
              target: { name: string };
              inputName?: string;
            }>;
          }) {
            const steps = loaded.test.requiredSteps;
            const step = steps[cursor];
            const meta = { by: "script", durationMs: 0 };
            if (!step) return { decision: { kind: "done" }, meta };
            const expected = expectedAction(step.description);
            const action = input.actions.find(
              (candidate) =>
                candidate.target.name === expected.name &&
                candidate.kind === expected.kind &&
                (expected.kind !== "fill" || candidate.inputName === "name"),
            );
            if (!action)
              throw new Error(
                `Missing legal action ${expected.name}; observed ${input.actions.map((candidate) => candidate.target.name).join(", ")}`,
              );
            cursor++;
            return {
              decision: {
                kind: "action",
                actionId: action.id,
                captureAfter: true,
              },
              meta,
            };
          },
        };
    const errorsBefore = browserErrors.length;
    const record = await runTest({
      test: loaded.test,
      testFile: loaded.file,
      testSha256: loaded.sha256,
      chooser,
      verifier: live ? createJevVerifier() : scriptedVerifier,
      browser,
      runsDir: output,
    });
    const summary = {
      test: record.test.name,
      verdict: record.verdict,
      path: record.path.status,
      actions: record.path.observed.length,
      errors: browserErrors.slice(errorsBefore),
      evidence: join(output, record.id, "run.json"),
    };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
    if (record.verdict.status !== "passed" || summary.errors.length)
      process.exitCode = 1;
  }
  writeFileSync(
    join(output, "summary.json"),
    `${JSON.stringify({ mode: live ? "live-jev" : "offline-scripted", summaries }, null, 2)}\n`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((done) => setTimeout(done, 5000)),
  ]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
  rmSync(directory, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.ROOST_DATA_DIR;
  else process.env.ROOST_DATA_DIR = previousData;
  if (previousUrl === undefined) delete process.env.ROOST_JEXO_START_URL;
  else process.env.ROOST_JEXO_START_URL = previousUrl;
}
