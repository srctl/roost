import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { chromium } from "playwright";
import {
  changeAgentNavigation,
  readAgentNavigation,
} from "../../src/server/agents/navigation.server";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import {
  createCodingJob,
  updateCodingJob,
} from "../../src/server/coding/store.server";
import { saveNote } from "../../src/server/notes/store.server";
import { putMessage } from "../../src/server/runs/timeline.server";

// Own database, listener and fixture worker lease: never visits a live instance.
process.umask(0o022);
const directory = mkdtempSync("/tmp/roost-approved-browser-");
const evidence =
  process.env.ROOST_BROWSER_EVIDENCE_DIR ?? "/tmp/roost-approved-evidence";
mkdirSync(evidence, { recursive: true });
const previous = process.env.ROOST_DATA_DIR;
process.env.ROOST_DATA_DIR = directory;
const run = Effect.runPromise;
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = (probe.address() as { port: number }).port;
await new Promise<void>((done) => probe.close(() => done()));
const base = `http://127.0.0.1:${port}`;
const id = randomUUID(),
  other = randomUUID(),
  jobId = randomUUID(),
  sectionId = randomUUID();
for (const [agentId, name] of [
  [id, "Integration Scout"],
  [other, "Retained River"],
] as const)
  await run(
    saveAgent({
      id: agentId,
      name,
      instructions: "Isolated browser fixture",
      character: "moss",
      model: "fake",
      kind: "coding",
    }),
  );
await run(
  changeAgentNavigation({ action: "create", id: sectionId, name: "Projects" }),
);
await run(changeAgentNavigation({ action: "move", agentId: id, sectionId }));
await run(
  saveNote(id, {
    requestId: randomUUID(),
    revision: 0,
    blocks: [
      {
        id: randomUUID(),
        type: "paragraph",
        content: [{ text: "Notes retained until confirmed deletion." }],
      },
    ],
  }),
);
await run(
  createCodingJob({
    id: jobId,
    agentId: id,
    title: "Combined integration",
    brief: "Fixture only",
    cwd: directory,
    sessionName: "fixture-only",
    workerName: "fixture-only",
    workerKind: "codex",
  }),
);
await run(
  updateCodingJob(id, jobId, {
    status: "review",
    sessionIdentity: "isolated-fixture",
    nativeSessionId: "isolated-native",
    lastWorkerState: "idle",
    observedWorking: true,
  }),
);
await run(
  withAgentStore((db) => {
    // A future lease prevents all actual worker transport while UI mutations remain available.
    db.prepare("INSERT INTO worker_lease VALUES(1,'browser-fixture',?)").run(
      Date.now() + 3_600_000,
    );
    for (const a of [id, other])
      db.prepare("INSERT INTO timeline_imports VALUES(?)").run(a);
    for (let index = 0; index < 4; index++) {
      const input = `message-${index}`;
      db.prepare(
        "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,status,createdAt) VALUES(?,?,?,'Fixture','sent',?)",
      ).run(input, jobId, id, index + 1);
      db.prepare(
        "INSERT INTO coding_worker_messages(inputId,jobId,agentId,sessionIdentity,nativeSessionId,deliveredAt,completedAt,responseId) VALUES(?,?,?,'isolated-fixture','isolated-native',1,2,?)",
      ).run(input, jobId, id, `response-${index}`);
      putMessage(
        db,
        id,
        {
          id: input,
          role: "user",
          text: `Fixture message ${index + 1}`,
          createdAt: index + 1,
        },
        jobId,
      );
      putMessage(
        db,
        id,
        {
          id: `response-${index}`,
          role: "assistant",
          text: "The same assignment worker replied.\nThis paragraph should wrap naturally on mobile.",
          createdAt: index + 2,
        },
        jobId,
      );
    }
  }),
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(ROOST_|NITRO_|CODEX_|HERDR_)/.test(key) &&
      !["HOST", "PORT"].includes(key),
  ),
);
Object.assign(env, {
  ROOST_DATA_DIR: directory,
  CODEX_HOME: directory,
  ROOST_CODEX_BINARY: resolve("tests/fixtures/chat-server.mjs"),
  HOST: "127.0.0.1",
  PORT: String(port),
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: String(port),
});
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (data) => {
  logs += data;
});
server.stderr.on("data", (data) => {
  logs += data;
});
const browser = await chromium.launch({
  executablePath: process.env.ROOST_TEST_CHROME,
});
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {}
    if (attempt === 99) throw Error(logs);
    await new Promise((done) => setTimeout(done, 100));
  }
  const styling: unknown[] = [];
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    // Each URL starts in a fresh browser context: no prior Notes CSS cache.
    for (const [route, path] of [
      ["chat", `/agents/${id}`],
      ["jobs", `/agents/${id}/jobs?job=${jobId}`],
      ["notes", `/agents/${id}/note`],
    ] as const) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + path);
      await page
        .getByRole("button", {
          name: "Settings for Integration Scout",
          exact: true,
        })
        .waitFor();
      if (route === "jobs")
        await page
          .getByRole("textbox", { name: "Message worker", exact: true })
          .waitFor();
      if (route === "notes")
        await page
          .getByText("Notes retained until confirmed deletion.", {
            exact: true,
          })
          .waitFor();
      await page.waitForTimeout(350);
      const computed = await page.evaluate(() => ({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
        settingsDisplay: getComputedStyle(document.querySelector("header")!)
          .display,
        stylesheets: [
          ...document.querySelectorAll<HTMLLinkElement>(
            'link[rel="stylesheet"]',
          ),
        ].map((link) => link.href),
      }));
      assert.equal(computed.overflow, false, `${label} ${route} fits width`);
      const rootCss = computed.stylesheets.find((url) =>
        /reset-[^/]+\.css/.test(url),
      );
      assert.ok(rootCss, "root stylesheet is linked on a fresh route");
      const css = await (await fetch(rootCss)).text();
      assert.ok(
        css.includes("@layer priority"),
        "root reset includes compiled StyleX rules",
      );
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: join(evidence, `${label}-${route}-production.png`),
      });
      styling.push({ label, route, ...computed, rootCssBytes: css.length });
      await context.close();
    }
  }
  writeFileSync(
    join(evidence, "production-styling.json"),
    JSON.stringify(styling, null, 2),
  );
  // Existing PR37 suite exercises four widths, focus, drafts and keyboard emulation.
  const mobile = spawn(
    process.execPath,
    ["--import", "tsx", "tests/browser/job-worker-mobile.ts"],
    {
      env: {
        ...env,
        ROOST_JOB_REVIEW_URL: `${base}/agents/${id}/jobs?job=${jobId}`,
        ROOST_BROWSER_EVIDENCE_DIR: evidence,
        ROOST_BROWSER_EXECUTABLE: process.env.ROOST_TEST_CHROME,
      },
      stdio: "inherit",
    },
  );
  assert.equal(
    (await once(mobile, "exit"))[0],
    0,
    "PR37 mobile/desktop browser suite",
  );
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(`${base}/agents/${id}`);
    await page
      .getByRole("button", {
        name: "Settings for Integration Scout",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Delete agent", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Delete Integration Scout?", exact: true })
      .waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: join(evidence, `${label}-delete-confirmation.png`),
    });
    await page
      .getByRole("button", { name: "Delete permanently", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "coding worker may still be active" })
      .waitFor();
    assert.equal((await run(readAgentNavigation())).memberships[id], sectionId);
    await context.close();
  }
  await run(
    withAgentStore((db) => {
      db.prepare("UPDATE coding_jobs SET status='completed' WHERE id=?").run(
        jobId,
      );
      db.prepare(
        "INSERT INTO coding_job_inputs(id,jobId,agentId,prompt,status,createdAt) VALUES('late',?,?,'Queued direct work','queued',10)",
      ).run(jobId, id);
    }),
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(`${base}/agents/${id}`);
  await page
    .getByRole("button", {
      name: "Settings for Integration Scout",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Delete agent", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "queued or unsettled work" })
    .waitFor();
  await page.screenshot({
    path: join(evidence, "mobile-terminal-queued-deletion-blocked.png"),
  });
  await run(
    withAgentStore((db) =>
      db.exec(
        "UPDATE coding_job_inputs SET status='abandoned' WHERE id='late'",
      ),
    ),
  );
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await page.waitForURL(`${base}/`);
  const navigation = await run(readAgentNavigation());
  assert.equal(navigation.memberships[id], undefined);
  assert.equal(navigation.sections[0]?.id, sectionId);
  await run(
    withAgentStore((db) => {
      assert.equal(
        db.prepare("SELECT name FROM agents WHERE id=?").get(other)?.name,
        "Retained River",
      );
      assert.equal(
        db.prepare("SELECT count(*) n FROM agent_notes WHERE agentId=?").get(id)
          ?.n,
        0,
      );
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM conversation_records WHERE agentId=?",
          )
          .get(id)?.n,
        0,
      );
    }),
  );
  await page.screenshot({
    path: join(evidence, "mobile-after-fixture-deletion.png"),
  });
  await context.close();
  console.log(
    "Fresh production Chat/Jobs/Notes styling, deletion guards and cleanup, and PR37 browser suite passed.",
  );
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await once(server, "exit");
  writeFileSync(join(evidence, "integration-server.log"), logs);
  if (previous === undefined) delete process.env.ROOST_DATA_DIR;
  else process.env.ROOST_DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
}
