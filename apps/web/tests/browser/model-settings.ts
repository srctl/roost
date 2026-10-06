import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { type Browser, chromium } from "playwright";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { AuthStore } from "../../src/server/auth/store.server";
import { putMessage } from "../../src/server/runs/timeline.server";

// Always launches its own loopback server and database. Never accepts a live URL.
const directory = mkdtempSync(
  join(tmpdir(), "roost-browser-agent-navigation-"),
);
const previous = process.env.ROOST_DATA_DIR;
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
const env = {
  ...process.env,
  ROOST_DATA_DIR: directory,
  CODEX_HOME: directory,
  ROOST_CODEX_BINARY: resolve("tests/fixtures/chat-server.mjs"),
  HOST: "127.0.0.1",
  PORT: String(port),
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: String(port),
};
for (const key of [
  "ROOST_DESKTOP_ORIGIN",
  "ROOST_DESKTOP_DISPLAY",
  "ROOST_DESKTOP_VNC_PORT",
  "ROOST_PUSH_SUBJECT",
])
  delete env[key as keyof typeof env];
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
let browser: Browser | undefined;
const base = `http://127.0.0.1:${port}`;
try {
  browser = await chromium.launch({
    executablePath: process.env.ROOST_TEST_CHROME || undefined,
    args: ["--no-sandbox"],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (
          await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(500),
          })
        ).ok
      )
        break;
    } catch {}
    if (i === 99) throw new Error(logs);
    await new Promise((done) => setTimeout(done, 100));
  }
  let mutation:
    | { url: string; body: string; headers: Record<string, string> }
    | undefined;
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    const id = randomUUID(),
      name = `${label} Scout`;
    await Effect.runPromise(
      saveAgent({
        id,
        name,
        instructions: "Keep this soul",
        character: "moss",
        model: "gpt-6-astra",
        reasoningEffort: "high",
      }),
    );
    await Effect.runPromise(
      withAgentStore((db) => {
        db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
        putMessage(db, id, {
          id: "saved-message",
          role: "assistant",
          text: "History stays here",
        });
      }),
    );
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().startsWith(base))
        mutation = {
          url: request.url(),
          body: request.postData() ?? "",
          headers: request.headers(),
        };
    });
    await page.goto(`${base}/agents/${id}`);
    const conversation = page.getByRole("region", {
      name: `Conversation with ${name}`,
      exact: true,
    });
    await conversation.getByRole("textbox").fill("Keep my unsent draft");
    const activeUrl = page.url();
    await page
      .getByRole("button", { name: `Settings for ${name}`, exact: true })
      .click();
    const form = page.getByRole("form", { name: "Model settings" });
    await form
      .getByRole("combobox", { name: "Model", exact: true })
      .selectOption("gpt-6.1-sol");
    await form
      .getByRole("combobox", { name: "Reasoning effort", exact: true })
      .selectOption("low");
    await form
      .getByRole("button", { name: "Save model settings", exact: true })
      .click();
    await form
      .getByRole("status")
      .filter({ hasText: "Model settings saved" })
      .waitFor();
    const saved = await Effect.runPromise(
      withAgentStore((db) =>
        db
          .prepare(
            "SELECT model,reasoningEffort,instructions FROM agents WHERE id=?",
          )
          .get(id),
      ),
    );
    assert.equal(saved?.model, "gpt-6.1-sol");
    assert.equal(saved?.reasoningEffort, "low");
    assert.equal(saved?.instructions, "Keep this soul");
    await page
      .getByRole("button", { name: "Close agent settings", exact: true })
      .click();
    assert.equal(page.url(), activeUrl);
    assert.equal(
      await conversation.getByRole("textbox").inputValue(),
      "Keep my unsent draft",
    );
    assert.ok(
      await conversation
        .getByText("History stays here", { exact: true })
        .isVisible(),
    );
    await context.close();
    console.log(
      `${label}: model/effort save, soul/history/draft and URL preservation passed`,
    );
  }
  assert.ok(mutation);
  const store = new AuthStore(directory),
    authOrigin = `http://localhost:${port}`;
  store.setup(authOrigin);
  const secret = store.createSession("fixture-credential");
  store.close();
  const request = (headers: Record<string, string>) =>
    fetch(mutation.url.replace(base, authOrigin), {
      method: "POST",
      headers: {
        ...Object.fromEntries(
          Object.entries(mutation.headers).filter(([key]) =>
            key.startsWith("x-"),
          ),
        ),
        "content-type": mutation.headers["content-type"] ?? "application/json",
        origin: authOrigin,
        ...headers,
      },
      body: mutation.body,
    });
  assert.equal((await request({})).status, 401);
  assert.equal(
    (
      await request({
        cookie: `__Host-roost-session=${secret}`,
        origin: "https://elsewhere.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await request({ cookie: `__Host-roost-session=${secret}` })).status,
    200,
  );
  console.log(
    "Compiled model endpoint: unauthenticated 401, foreign origin 403, instance session accepted",
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
  if (previous === undefined) delete process.env.ROOST_DATA_DIR;
  else process.env.ROOST_DATA_DIR = previous;
  rmSync(directory, { recursive: true, force: true });
}
