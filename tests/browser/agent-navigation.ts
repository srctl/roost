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
import { readAgentNavigation } from "../../src/server/agents/navigation.server";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { AuthStore } from "../../src/server/auth/store.server";
import { openReplyThread } from "../../src/server/runs/threads.server";
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

  const mutations: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }[] = [];
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
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const [label, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ] as const) {
    const id = randomUUID();
    const name = `${label} Scout`,
      renamed = `${label} Explorer`,
      sectionName = `${label} Projects`;
    await Effect.runPromise(
      saveAgent({
        id,
        name,
        instructions: "Fixture soul stays unchanged",
        character: "moss",
        model: "fake",
      }),
    );
    await Effect.runPromise(
      withAgentStore((db) => {
        db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id);
        putMessage(db, id, {
          id: "parent-message",
          role: "user",
          text: "Keep my conversation",
        });
      }),
    );
    const child = await Effect.runPromise(
      openReplyThread(id, "parent-message"),
    );
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      colorScheme: label === "desktop" ? "dark" : "light",
    });
    const page = await context.newPage();
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().startsWith(base))
        mutations.push({
          url: request.url(),
          body: request.postData() ?? "",
          headers: request.headers(),
        });
    });
    await page.goto(`${base}/agents/${id}`);
    const main = page.getByRole("region", {
      name: `Conversation with ${name}`,
      exact: true,
    });
    await main.getByRole("textbox").fill("Main draft must survive");
    await page.evaluate((child) => {
      history.pushState(null, "", `?conversation=${child}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, child.id);
    const thread = page.getByRole("region", {
      name: "Reply thread",
      exact: true,
    });
    await thread.getByRole("textbox").fill("Reply draft must survive");
    // Mobile thread view covers the header; retain the main draft while editing settings.
    if (label === "mobile")
      await thread
        .getByRole("button", { name: "Close thread", exact: true })
        .click();
    const activeUrl = page.url();
    await page
      .getByRole("button", { name: `Settings for ${name}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Edit display name", exact: true })
      .click();
    const editor = page.getByRole("textbox", {
      name: "Display name",
      exact: true,
    });
    await editor.fill("   ");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "between 1 and 60" })
      .waitFor();
    await editor.fill("Cancelled name");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Edit display name", exact: true })
      .click();
    assert.equal(await editor.inputValue(), name);
    await editor.fill(`  ${renamed}  `);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("heading", { name: `${renamed} settings`, exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close agent settings", exact: true })
      .click();
    assert.equal(page.url(), activeUrl);
    const renamedMain = page.getByRole("region", {
      name: `Conversation with ${renamed}`,
      exact: true,
      includeHidden: true,
    });
    assert.equal(
      await renamedMain.getByRole("textbox").inputValue(),
      "Main draft must survive",
    );
    if (label === "desktop")
      assert.equal(
        await thread.getByRole("textbox").inputValue(),
        "Reply draft must survive",
      );
    const openNavigation = async () => {
      if (label === "mobile")
        await page
          .getByRole("button", { name: "Open navigation", exact: true })
          .click();
    };
    const closeNavigation = async () => {
      if (label === "mobile")
        await page
          .getByRole("button", { name: "Close navigation", exact: true })
          .click();
    };
    await openNavigation();
    const sidebar = page.locator(
      label === "mobile" ? "#mobile-agent-sidebar" : "#agent-sidebar",
    );
    const defaultAgents = sidebar.locator(`#${label}-section-`);
    await defaultAgents
      .getByRole("link", { name: renamed, exact: true })
      .waitFor();
    const defaultAgentUrls = await defaultAgents
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const assertPlainDefaultAgents = async () => {
      assert.equal(
        await sidebar
          .getByText("Ungrouped", { exact: true })
          .and(sidebar.locator(":not(option)"))
          .count(),
        0,
        `${label}: default agents have no Ungrouped heading`,
      );
      assert.equal(
        await defaultAgents.locator("..").textContent(),
        (await defaultAgents.getByRole("link").allTextContents()).join(""),
        `${label}: the default list contains only agent text, with no label`,
      );
      assert.deepEqual(
        await defaultAgents
          .getByRole("link")
          .evaluateAll((links) =>
            links.map((link) => link.getAttribute("href")),
          ),
        defaultAgentUrls,
        `${label}: default agent order and routes stay unchanged`,
      );
    };
    await assertPlainDefaultAgents();
    await sidebar
      .getByRole("button", { name: "Manage sections", exact: true })
      .click();
    await sidebar
      .getByRole("button", { name: "Create section", exact: true })
      .click();
    await sidebar
      .getByRole("textbox", { name: "Section name", exact: true })
      .fill(sectionName);
    const createAttempts: string[] = [];
    await page.route("**/*", async (route) => {
      const request = route.request();
      const body = request.postData() ?? "";
      if (
        request.method() !== "POST" ||
        !body.includes("create") ||
        !body.includes(sectionName)
      ) {
        await route.continue();
        return;
      }
      createAttempts.push(body);
      if (createAttempts.length === 1) {
        // Commit on the real isolated server, then lose the successful response.
        const committed = await route.fetch();
        assert.equal(committed.status(), 200);
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Simulated lost creation response",
        });
      } else {
        await route.continue();
      }
    });
    await sidebar.getByRole("button", { name: "Save", exact: true }).click();
    await sidebar.getByRole("alert").last().waitFor();
    const committedSections = (
      await Effect.runPromise(readAgentNavigation())
    ).sections.filter((section) => section.name === sectionName);
    assert.equal(
      committedSections.length,
      1,
      "first create committed despite the failed response",
    );
    assert.equal(
      await sidebar
        .getByRole("textbox", { name: "Section name", exact: true })
        .inputValue(),
      sectionName,
    );
    await sidebar.getByRole("button", { name: "Save", exact: true }).click();
    await sidebar
      .getByRole("button", {
        name: `Rename section ${sectionName}`,
        exact: true,
      })
      .waitFor();
    assert.equal(createAttempts.length, 2, "retried the failed creation");
    assert.equal(
      createAttempts[1],
      createAttempts[0],
      "retry reuses the creation UUID and payload",
    );
    assert.deepEqual(
      (await Effect.runPromise(readAgentNavigation())).sections.filter(
        (section) => section.name === sectionName,
      ),
      committedSections,
      "retry preserves exactly one section with its original UUID",
    );
    await page.unroute("**/*");
    assert.equal(
      await sidebar
        .getByRole("button", { name: sectionName, exact: true })
        .isVisible(),
      true,
      `${label}: created sections have labels`,
    );
    await assertPlainDefaultAgents();
    assert.equal(
      await sidebar
        .getByRole("combobox", { name: `Section for ${renamed}`, exact: true })
        .locator("option", { hasText: /^Ungrouped$/ })
        .count(),
      1,
      `${label}: management retains the Ungrouped option`,
    );
    console.log(
      `${label}: lost-response creation retry preserved one section and UUID`,
    );
    await sidebar
      .getByRole("combobox", { name: `Section for ${renamed}`, exact: true })
      .selectOption({ label: sectionName });
    await sidebar
      .getByRole("button", { name: "Done managing sections", exact: true })
      .click();
    const section = sidebar.getByRole("button", {
      name: sectionName,
      exact: true,
    });
    await section.click();
    await page.waitForFunction(
      ({ id }) =>
        document
          .querySelector(`[aria-controls$="section-${id}"]`)
          ?.getAttribute("aria-expanded") === "false",
      { id: (await Effect.runPromise(readAgentNavigation())).memberships[id] },
    );
    assert.equal(
      await sidebar.getByRole("link", { name: renamed, exact: true }).count(),
      0,
    );
    await closeNavigation();
    assert.equal(page.url(), activeUrl);
    assert.equal(
      await renamedMain.getByRole("textbox").inputValue(),
      "Main draft must survive",
    );
    if (label === "desktop")
      assert.equal(
        await thread.getByRole("textbox").inputValue(),
        "Reply draft must survive",
      );
    if (label === "mobile") {
      await page.evaluate((child) => {
        history.pushState(null, "", `?conversation=${child}`);
        dispatchEvent(new PopStateEvent("popstate"));
      }, child.id);
      assert.equal(
        await thread.getByRole("textbox").inputValue(),
        "Reply draft must survive",
      );
      await thread
        .getByRole("button", { name: "Close thread", exact: true })
        .click();
    }
    await page.reload();
    await openNavigation();
    assert.equal(await section.getAttribute("aria-expanded"), "false");
    await section.click();
    await sidebar.getByRole("link", { name: renamed, exact: true }).waitFor();
    await sidebar
      .getByRole("button", { name: "Manage sections", exact: true })
      .click();
    await sidebar
      .getByRole("button", {
        name: `Rename section ${sectionName}`,
        exact: true,
      })
      .click();
    await sidebar
      .getByRole("textbox", { name: "Section name", exact: true })
      .fill(`${sectionName} renamed`);
    await sidebar.getByRole("button", { name: "Save", exact: true }).click();
    await sidebar
      .getByRole("button", {
        name: `Delete section ${sectionName} renamed`,
        exact: true,
      })
      .click();
    await sidebar
      .getByRole("button", { name: "Delete section", exact: true })
      .click();
    await sidebar
      .getByRole("button", {
        name: `Delete section ${sectionName} renamed`,
        exact: true,
      })
      .waitFor({ state: "detached" });
    assert.equal(
      await sidebar
        .getByRole("combobox", { name: `Section for ${renamed}`, exact: true })
        .inputValue(),
      "",
    );
    await sidebar
      .getByRole("button", { name: "Done managing sections", exact: true })
      .click();
    await defaultAgents
      .getByRole("link", { name: renamed, exact: true })
      .waitFor();
    await assertPlainDefaultAgents();
    await closeNavigation();
    assert.equal(page.url(), activeUrl);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await context.close();
    console.log(
      `${label}: rename validation/cancel/save, section create/move/rename/delete, persisted collapse, stable conversation URL and in-memory drafts passed`,
    );
  }
  // Exercise the actual compiled mutation URLs through established instance auth.
  assert.ok(mutations.length >= 2, "captured actual server function requests");
  const store = new AuthStore(directory);
  const authOrigin = `http://localhost:${port}`;
  store.setup(authOrigin);
  const secret = store.createSession("fixture-credential");
  store.close();
  for (const mutation of [
    mutations.find((m) => m.body.includes("Explorer")),
    mutations.find((m) => m.body.includes("collapse")),
  ]) {
    assert.ok(mutation, "captured rename and section mutation");
    const request = (headers: Record<string, string>) =>
      fetch(mutation.url.replace(base, authOrigin), {
        method: "POST",
        headers: {
          ...Object.fromEntries(
            Object.entries(mutation.headers).filter(([key]) =>
              key.startsWith("x-"),
            ),
          ),
          "content-type":
            mutation.headers["content-type"] ?? "application/json",
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
    const allowed = await request({ cookie: `__Host-roost-session=${secret}` });
    assert.equal(allowed.status, 200, `${await allowed.text()}\n${logs}`);
  }
  console.log(
    "Compiled rename/section endpoints: unauthenticated 401, foreign origin 403, instance session accepted",
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
