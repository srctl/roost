import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import { chromium, type Locator, type Page } from "playwright";
import {
  saveAgent,
  withAgentStore,
} from "../../src/server/agents/store.server";
import { handleAgentTool } from "../../src/server/codex/agent-tools.server";
import { setDashboardPreference } from "../../src/server/dashboards/store.server";
import {
  WeatherProvider,
  weatherProvider,
} from "../../src/server/dashboards/weather-provider.server";
import { MobileTokens } from "../../src/server/mobile/tokens.server";
import { finishRun, type Run } from "../../src/server/runs/store.server";
import { putMessage } from "../../src/server/runs/timeline.server";

// Exercise a disposable copy of the built app and real tools with the existing
// injected local transport seam. Never edit the production build or call a provider.
const directory = mkdtempSync(join(tmpdir(), "roost-weather-browser-"));
process.env.ROOST_DATA_DIR = directory;
writeFileSync(join(directory, "weather-fixture"), "weather-browser");
const control = (clockOffsetMs = 0, failForecast = false) =>
  writeFileSync(
    join(directory, "weather-control.json"),
    JSON.stringify({ clockOffsetMs, failForecast }),
  );
control();
writeFileSync(
  join(directory, "auth.json"),
  JSON.stringify({ OPENAI_API_KEY: "fixture" }),
);
const preload = resolve("tests/fixtures/weather-provider.mjs");
const fixture = await import(pathToFileURL(preload).href);
const localProvider = new WeatherProvider({
  transport: fixture.weatherTransport,
});
weatherProvider.search = localProvider.search.bind(localProvider);
weatherProvider.location = localProvider.location.bind(localProvider);
weatherProvider.forecast = localProvider.forecast.bind(localProvider);
const build = join(directory, "build");
cpSync(resolve(".output"), build, { recursive: true, dereference: true });
for (const entry of ["server/index.mjs", "server/_ssr/ssr.mjs"]) {
  const path = join(build, entry);
  const original = readFileSync(path, "utf8");
  const target = "var weatherProvider = new WeatherProvider();";
  assert.equal(
    original.split(target).length - 1,
    1,
    `Exactly one known constructor in ${entry}`,
  );
  writeFileSync(
    path,
    original.replace(
      target,
      "var weatherProvider = new WeatherProvider({ transport: globalThis.__roostWeatherTestTransport });",
    ),
  );
}
const run = Effect.runPromise;
const id = randomUUID();
await run(
  saveAgent({
    id,
    name: "Moss",
    character: "moss",
    model: "fixture",
    instructions: "Local weather browser fixture only",
  }),
);
await run(
  withAgentStore((db) =>
    db.prepare("INSERT INTO timeline_imports VALUES (?)").run(id),
  ),
);
await run(setDashboardPreference(true));
const tokens = new MobileTokens(directory);
const device = tokens.create("Weather browser verification");
tokens.close();
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const address = probe.address();
assert.ok(address && typeof address !== "string");
const port = address.port;
await new Promise<void>((done) => probe.close(() => done()));
const env = {
  ...process.env,
  ROOST_DATA_DIR: directory,
  ROOST_CODEX_BINARY: resolve("tests/fixtures/chat-server.mjs"),
  HOST: "127.0.0.1",
  PORT: String(port),
  NITRO_HOST: "127.0.0.1",
  NITRO_PORT: String(port),
};
delete env.TYPESAFE_API_KEY;
const server = spawn(
  process.execPath,
  ["--import", preload, join(build, "server/index.mjs")],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
server.stdout.on("data", (data) => {
  logs += data;
});
server.stderr.on("data", (data) => {
  logs += data;
});
const browser = await chromium
  .launch({
    executablePath: process.env.ROOST_TEST_CHROME,
    args: ["--no-sandbox"],
  })
  .catch(async (error) => {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    rmSync(directory, { recursive: true, force: true });
    throw error;
  });
const base = `http://127.0.0.1:${port}`;
const output = resolve("output/playwright/juxi");
mkdirSync(output, { recursive: true });
let currentPage: Page | undefined;

async function mobile(path: string) {
  const response = await fetch(`${base}/api/mobile/v1/agents/${id}/${path}`, {
    headers: { Authorization: `Bearer ${device.secret}` },
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function configuration(key: string) {
  const snapshot = await mobile("dashboard");
  const widget = snapshot.widgets.find(
    (item: { key: string }) => item.key === key,
  );
  assert.ok(widget);
  return widget;
}
async function forecast(weather: Locator, unit: "celsius" | "fahrenheit") {
  await weather
    .getByLabel(`${unit === "celsius" ? 20 : 68} degrees ${unit}`, {
      exact: true,
    })
    .waitFor();
  await weather
    .getByRole("table", { name: "Five-day forecast", exact: true })
    .waitFor();
  await weather.getByText("Seattle", { exact: true }).waitFor();
  assert.equal(
    await weather
      .getByRole("link", { name: "Weather by Open-Meteo ↗", exact: true })
      .getAttribute("href"),
    "https://open-meteo.com/",
  );
  assert.equal(
    await weather
      .getByRole("button", {
        name: unit === "celsius" ? "Celsius" : "Fahrenheit",
        exact: true,
      })
      .getAttribute("aria-pressed"),
    "true",
  );
}
async function geometry(page: Page, weather: Locator) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await weather.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
    true,
    "weather fits its dashboard or chat container",
  );
}
async function noChatSubmissions(expected = 1) {
  const state = await run(
    withAgentStore((db) =>
      db
        .prepare(
          "SELECT COUNT(*) AS count, SUM(status <> 'completed') AS active FROM runs WHERE agentId=?",
        )
        .get(id),
    ),
  );
  assert.equal(
    state?.count,
    expected,
    "weather controls never send a chat message",
  );
  if (expected) assert.equal(state?.active, 0);
}

try {
  for (let attempt = 0; attempt < 100; attempt++) {
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
    if (attempt === 99) throw new Error(logs);
    await new Promise((done) => setTimeout(done, 100));
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  currentPage = page;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/agents/${id}/dashboard`);
  await page.getByRole("button", { name: "Hide chat", exact: true }).click();
  await page.getByRole("button", { name: "Add tracker", exact: true }).click();
  const form = page.getByRole("form", { name: "New tracker", exact: true });
  await form
    .getByLabel("Tracker type", { exact: true })
    .selectOption("weather");
  await form
    .getByLabel("Tracker name", { exact: true })
    .fill("Seattle weather");
  assert.equal(
    await form
      .getByRole("button", { name: "Create tracker", exact: true })
      .isDisabled(),
    true,
    "creating weather requires an explicitly selected city",
  );
  await form.getByLabel("Weather city", { exact: true }).fill("Seattle");
  await form
    .getByRole("button", { name: "Search cities", exact: true })
    .click();
  await form
    .getByRole("button", { name: /Seattle.*Washington.*United States/ })
    .click();
  await form
    .getByLabel("Weather temperature unit", { exact: true })
    .selectOption("fahrenheit");
  await form
    .getByRole("button", { name: "Create tracker", exact: true })
    .click();
  const article = page.getByRole("article", {
    name: "Seattle weather",
    exact: true,
  });
  const weather = article.getByRole("region", { name: "Weather", exact: true });
  await forecast(weather, "fahrenheit");
  await noChatSubmissions(0);
  const snapshot = await mobile("dashboard");
  const saved = snapshot.widgets.find(
    (item: { title: string }) => item.title === "Seattle weather",
  );
  assert.ok(saved);
  assert.deepEqual(saved.blocks, [
    { type: "weather", id: "items", locationId: 5809844, unit: "fahrenheit" },
  ]);
  const key: string = saved.key;
  await page.getByLabel("View", { exact: true }).selectOption("summary");
  await forecast(weather, "fahrenheit");
  await weather.getByRole("button", { name: "Celsius", exact: true }).click();
  await forecast(weather, "celsius");
  assert.equal((await configuration(key)).blocks[0].unit, "celsius");
  await page.reload();
  const hideChat = page.getByRole("button", { name: "Hide chat", exact: true });
  if (await hideChat.count()) await hideChat.click();
  await forecast(weather, "celsius");
  assert.equal(
    await page.getByLabel("View", { exact: true }).inputValue(),
    "summary",
  );
  await geometry(page, weather);
  await article.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "weather-desktop-dashboard.png"),
  });

  // Model a user-authorized active chat run without starting an LLM. The actual
  // agent tool must save the weather configuration and persist its inline reference.
  const source = await run(
    withAgentStore((db) => {
      const runId = randomUUID();
      const owner = String(
        db.prepare("SELECT owner FROM worker_lease WHERE id=1").get()?.owner ??
          "weather-fixture",
      );
      const prompt = "Keep Seattle weather here in our chat.";
      db.prepare(
        "INSERT INTO runs(id,agentId,conversationId,kind,prompt,status,createdAt,startedAt,owner) VALUES(?,?,?,'chat',?,'running',?,?,?)",
      ).run(runId, id, id, prompt, Date.now(), Date.now(), owner);
      putMessage(db, id, { id: runId, role: "user", text: prompt });
      return db.prepare("SELECT * FROM runs WHERE id=?").get(runId) as Run;
    }),
  );
  const latest = await configuration(key);
  const toolContext = {
    agentId: id,
    runId: source.id,
    allowMutations: true as const,
  };
  const toolSave = await handleAgentTool(toolContext, "roost_save_dashboard", {
    key,
    title: latest.title,
    blocks: latest.blocks,
    expectedRevision: latest.revision,
  });
  assert.equal(toolSave.success, true, JSON.stringify(toolSave));
  const show = await handleAgentTool(toolContext, "roost_show_dashboard", {
    key,
  });
  assert.equal(show.success, true, JSON.stringify(show));
  await run(finishRun(source, "completed", []));

  for (const [label, width, height, style] of [
    ["desktop", 1440, 1000, "codex"],
    ["phone", 390, 844, "messages"],
    ["narrow", 320, 740, "codex"],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: label === "phone" ? "dark" : "light",
      reducedMotion: "reduce",
    });
    await context.addCookies([
      { name: "roost.responseStyle", value: style, url: base },
    ]);
    const page = await context.newPage();
    currentPage = page;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/agents/${id}`);
    const chat = page.getByRole("region", {
      name: "Conversation with Moss",
      exact: true,
    });
    const composer = chat.getByRole("textbox", {
      name: "Message Moss",
      exact: true,
    });
    const inline = chat.getByRole("article", {
      name: "Seattle weather",
      exact: true,
    });
    const weather = inline.getByRole("region", {
      name: "Weather",
      exact: true,
    });
    await forecast(weather, "celsius");
    await composer.fill("Keep my unsent weather question");
    await weather
      .getByRole("button", { name: "Fahrenheit", exact: true })
      .click();
    await forecast(weather, "fahrenheit");
    assert.equal((await configuration(key)).blocks[0].unit, "fahrenheit");
    await weather
      .getByRole("button", { name: "Refresh weather", exact: true })
      .click();
    await forecast(weather, "fahrenheit");
    assert.equal(
      await composer.inputValue(),
      "Keep my unsent weather question",
    );
    await noChatSubmissions();
    await page.reload();
    await forecast(weather, "fahrenheit");
    assert.equal(
      await composer.inputValue(),
      "Keep my unsent weather question",
    );
    await geometry(page, weather);
    await inline.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `weather-${label}-chat.png`) });
    await weather.getByRole("button", { name: "Celsius", exact: true }).click();
    await forecast(weather, "celsius");
    if (label !== "desktop") {
      await page.goto(`${base}/agents/${id}/dashboard`);
      const card = page.getByRole("article", {
        name: "Seattle weather",
        exact: true,
      });
      const data = card.getByRole("region", { name: "Weather", exact: true });
      await forecast(data, "celsius");
      await geometry(page, data);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(output, `weather-${label}-dashboard.png`),
      });
    }
    await noChatSubmissions();
    await context.close();
    console.log(
      `${label}: local fixture weather, units, Summary focus, inline chat, draft safety and geometry passed`,
    );
  }

  currentPage = page;
  // Advance only fixture clocks. A provider outage keeps a clearly stale cache;
  // a later explicit refresh recovers without invented or duplicated observations.
  control(16 * 60 * 1000, true);
  await weather
    .getByRole("button", { name: "Refresh weather", exact: true })
    .click();
  await forecast(weather, "celsius");
  await weather
    .getByRole("status")
    .filter({ hasText: /last|cached|stale|unavailable/i })
    .waitFor();
  await page.screenshot({ path: join(output, "weather-provider-outage.png") });
  control(18 * 60 * 1000, false);
  await weather
    .getByRole("button", { name: "Refresh weather", exact: true })
    .click();
  await forecast(weather, "celsius");
  await weather
    .getByRole("status")
    .filter({ hasText: /last|cached|stale|unavailable/i })
    .waitFor({ state: "hidden" });
  await noChatSubmissions();
  assert.deepEqual(errors, []);
  const requests = readFileSync(
    join(directory, "weather-requests.jsonl"),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    requests.some(
      (item) => item.method === "search" && item.arguments.query === "Seattle",
    ),
  );
  assert.ok(
    requests.some(
      (item) => item.method === "location" && item.arguments.id === 5809844,
    ),
  );
  assert.ok(
    requests.some(
      (item) =>
        item.method === "forecast" && item.arguments.unit === "fahrenheit",
    ),
  );
  console.log(
    "provider outage retained a labelled stale forecast and explicit refresh recovered; all weather data came from the local transport",
  );
} catch (error) {
  console.error(error);
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: join(output, "weather-failure.png") });
    console.error((await currentPage.locator("body").innerText()).slice(-5000));
  }
  console.error(logs.slice(-5000));
  throw error;
} finally {
  await browser.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
  rmSync(directory, { recursive: true, force: true });
}
