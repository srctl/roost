import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect, Schema } from "effect";
import { availableDashboardFocus } from "../src/features/dashboards/presentation";
import {
  SaveDashboard,
  type WeatherUnit,
} from "../src/features/dashboards/schema";
import { WeatherReport } from "../src/features/dashboards/weather";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { handleAgentTool } from "../src/server/codex/agent-tools.server";
import {
  createDashboardTracker,
  updateDashboardContent,
} from "../src/server/dashboards/actions.server";
import {
  listDashboards,
  saveDashboard,
  setDashboardPreference,
} from "../src/server/dashboards/store.server";
import { getDashboardWeather } from "../src/server/dashboards/weather.server";
import {
  WeatherProvider,
  type WeatherTransport,
  weatherProvider,
} from "../src/server/dashboards/weather-provider.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

const run = Effect.runPromise;
const startTime = Date.parse("2026-09-19T12:00:00Z");
const location = {
  id: 1,
  name: "Test City",
  admin1: "Test Region",
  country: "Test Country",
  latitude: 40,
  longitude: -74,
  timezone: "UTC",
};
function forecast(now: number, unit: WeatherUnit = "celsius") {
  const symbol = unit === "celsius" ? "°C" : "°F";
  const midnight = Math.floor(now / 86400000) * 86400;
  return {
    utc_offset_seconds: 0,
    current_units: {
      temperature_2m: symbol,
      apparent_temperature: symbol,
      wind_speed_10m: "km/h",
    },
    daily_units: { temperature_2m_max: symbol, temperature_2m_min: symbol },
    current: {
      time: Math.floor(now / 1000),
      temperature_2m: unit === "celsius" ? 20 : 68,
      apparent_temperature: 19,
      weather_code: 2,
      is_day: 1,
      wind_speed_10m: 12,
    },
    daily: {
      time: Array.from({ length: 5 }, (_, index) => midnight + index * 86400),
      weather_code: [2, 1, 3, 61, 0],
      temperature_2m_max: [22, 23, 20, 18, 21],
      temperature_2m_min: [12, 13, 14, 11, 10],
      precipitation_probability_max: [0, 10, 20, 80, 0],
    },
  };
}

test("weather provider validates canonical values, shares requests, and marks bounded stale fallbacks", async () => {
  let now = startTime;
  let failure = false;
  let calls = 0;
  const provider = new WeatherProvider({
    now: () => now,
    transport: {
      search: async () => ({ results: [location] }),
      location: async () => location,
      forecast: async (_, unit) => {
        calls += 1;
        if (failure) throw new Error("Provider failure");
        return forecast(now, unit);
      },
    },
  });
  assert.equal((await provider.search("Test City"))[0]!.id, 1);
  const [first, second] = await Promise.all([
    provider.forecast(1, "celsius"),
    provider.forecast(1, "celsius"),
  ]);
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  assert.equal(first.current.temperature, 20);
  assert.equal(first.days.length, 5);
  assert.equal(first.days[0]!.date, "2026-09-19");
  assert.equal(first.observedAt, new Date(now).toISOString());
  assert.equal(first.stale, false);
  await provider.forecast(1, "celsius", true);
  assert.equal(calls, 1, "refresh has a sixty-second cooldown");
  now += 16 * 60000;
  failure = true;
  const stale = await provider.forecast(1, "celsius");
  assert.equal(stale.current.temperature, first.current.temperature);
  assert.equal(stale.updatedAt, first.updatedAt);
  assert.equal(stale.stale, true);
  assert.match(stale.notice!, /last available/);
  await provider.forecast(1, "celsius", true);
  assert.equal(calls, 2, "failed refreshes are also cooled down");
  now += 61000;
  failure = false;
  const recovered = await provider.forecast(1, "celsius", true);
  assert.equal(recovered.stale, false);
  assert.notEqual(recovered.updatedAt, first.updatedAt);
  assert.equal(
    (await provider.forecast(1, "fahrenheit")).current.temperature,
    68,
  );
  now += 25 * 3600000;
  failure = true;
  await assert.rejects(provider.forecast(1, "celsius"), /unavailable/);
});

test("weather rejects malformed provider data instead of inventing values and handles timezone transitions", async () => {
  const invalid: ((value: ReturnType<typeof forecast>) => unknown)[] = [
    (value) => ({
      ...value,
      current: { ...value.current, temperature_2m: null },
    }),
    (value) => ({
      ...value,
      current: { ...value.current, temperature_2m: NaN },
    }),
    (value) => ({ ...value, current: { ...value.current, weather_code: 100 } }),
    (value) => ({
      ...value,
      current: { ...value.current, wind_speed_10m: -1 },
    }),
    (value) => ({
      ...value,
      current: { ...value.current, time: value.current.time + 86400 },
    }),
    (value) => ({
      ...value,
      current_units: { ...value.current_units, temperature_2m: "°F" },
    }),
    (value) => ({ ...value, daily: { ...value.daily, weather_code: [1] } }),
    (value) => ({
      ...value,
      daily: {
        ...value.daily,
        precipitation_probability_max: [0, 0, 0, 0, 101],
      },
    }),
    (value) => ({
      ...value,
      daily: { ...value.daily, temperature_2m_min: [100, 0, 0, 0, 0] },
    }),
    (value) => ({
      ...value,
      daily: {
        ...value.daily,
        time: value.daily.time.map(() => value.daily.time[0]!),
      },
    }),
    (value) => ({
      ...value,
      daily: {
        ...value.daily,
        time: value.daily.time.map((time) => time - 86400),
      },
    }),
  ];
  for (const mutate of invalid) {
    const provider = new WeatherProvider({
      now: () => startTime,
      transport: {
        search: async () => ({}),
        location: async () => location,
        forecast: async () => mutate(forecast(startTime)),
      },
    });
    await assert.rejects(provider.forecast(1, "celsius"), /unavailable/);
  }
  for (const corrupt of [
    { ...location, timezone: "Bad/Timezone" },
    { ...location, latitude: 91 },
    { ...location, id: 2 },
  ]) {
    const provider = new WeatherProvider({
      transport: {
        search: async () => ({}),
        location: async () => corrupt,
        forecast: async () => ({}),
      },
    });
    await assert.rejects(provider.location(1), /unavailable/);
  }
  const now = Date.parse("2026-11-01T12:00:00Z");
  const raw = forecast(now);
  raw.utc_offset_seconds = -18000;
  raw.daily.time = [
    "2026-11-01T04:00Z",
    "2026-11-02T05:00Z",
    "2026-11-03T05:00Z",
    "2026-11-04T05:00Z",
    "2026-11-05T05:00Z",
  ].map((value) => Date.parse(value) / 1000);
  const provider = new WeatherProvider({
    now: () => now,
    transport: {
      search: async () => ({}),
      location: async () => ({ ...location, timezone: "America/New_York" }),
      forecast: async () => raw,
    },
  });
  const report = await provider.forecast(1, "celsius");
  assert.deepEqual(
    report.days.map((day) => day.date),
    ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"],
  );
  assert.throws(() =>
    Schema.decodeUnknownSync(WeatherReport)({
      ...report,
      updatedAt: "2026-02-30T12:00:00.000Z",
    }),
  );
});

test("weather schemas allow only configuration and unique interactive block IDs", () => {
  const config = {
    type: "weather",
    id: "weather",
    locationId: 1,
    unit: "celsius",
  };
  const widget = { key: "weather", title: "Weather", blocks: [config] };
  assert.deepEqual(Schema.decodeUnknownSync(SaveDashboard)(widget).blocks, [
    config,
  ]);
  for (const block of [
    { ...config, locationId: 0 },
    { ...config, unit: "kelvin" },
    { ...config, current: { temperature: 20 } },
    { ...config, url: "https://example.com" },
  ])
    assert.throws(() =>
      Schema.decodeUnknownSync(SaveDashboard)({ ...widget, blocks: [block] }),
    );
  assert.throws(() =>
    Schema.decodeUnknownSync(SaveDashboard)({
      ...widget,
      blocks: [config, { type: "todo-list", id: "weather", items: [] }],
    }),
  );
});

test("weather authenticated APIs preserve ownership, canonical config, CAS and offline edits", async (t) => {
  const directory = mkdtempSync("/tmp/roost-weather-");
  const old = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const device = tokens.create("Weather tests");
  const makeAgent = (name: string) =>
    run(
      saveAgent({
        id: randomUUID(),
        name,
        instructions: "Help",
        model: "fixture",
        character: "wisp",
      }),
    );
  const agent = await makeAgent("Weather");
  const other = await makeAgent("Other");
  let lookupCalls = 0;
  let weatherCalls = 0;
  let disconnected = false;
  let duringForecast: (() => Promise<void>) | undefined;
  const transport: WeatherTransport = {
    search: async () => {
      lookupCalls += 1;
      return { results: [location] };
    },
    location: async (id) => {
      lookupCalls += 1;
      if (disconnected) throw new Error("Offline");
      return { ...location, id };
    },
    forecast: async (_, unit) => {
      weatherCalls += 1;
      await duringForecast?.();
      return forecast(Date.now(), unit);
    },
  };
  const provider = new WeatherProvider({ transport });
  t.mock.method(weatherProvider, "search", provider.search.bind(provider));
  t.mock.method(weatherProvider, "location", provider.location.bind(provider));
  t.mock.method(weatherProvider, "forecast", provider.forecast.bind(provider));
  const handle = createMobileHandler(async () => {});
  const request = async (
    suffix: string,
    data?: unknown,
    owner = agent.id,
    authenticated = true,
  ) => {
    const response = await handle(
      new Request(
        `https://roost.example/api/mobile/v1/agents/${owner}/dashboard/${suffix}`,
        {
          method: data === undefined ? "GET" : "POST",
          headers: {
            ...(authenticated
              ? { Authorization: `Bearer ${device.secret}` }
              : {}),
            "Content-Type": "application/json",
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        },
      ),
    );
    assert.ok(response);
    return { status: response.status, value: await response.json() };
  };
  try {
    assert.equal((await request("weather/locations?query=Test")).status, 400);
    assert.equal(lookupCalls, 0);
    await run(setDashboardPreference(true));
    assert.equal(
      (
        await request(
          "weather/locations?query=Test",
          undefined,
          agent.id,
          false,
        )
      ).status,
      401,
    );
    for (const query of [
      "",
      "?query=x",
      "?query=Test&query=Other",
      `?query=Test&agentId=${other.id}`,
    ])
      assert.equal((await request(`weather/locations${query}`)).status, 400);
    assert.equal(
      (await request("weather/locations?query=Test", undefined, randomUUID()))
        .status,
      400,
    );
    assert.equal(
      lookupCalls,
      0,
      "authorization and query validation precede provider calls",
    );
    const locations = await request("weather/locations?query=Test");
    assert.equal(locations.status, 200);
    assert.equal(locations.value[0].name, location.name);
    const create = {
      key: "weather",
      kind: "weather",
      title: "Test weather",
      locationId: 1,
      unit: "celsius" as const,
    };
    const created = await request("tracker", create);
    assert.equal(created.status, 200);
    assert.deepEqual(created.value.blocks, [
      { type: "weather", id: "items", locationId: 1, unit: "celsius" },
    ]);
    assert.deepEqual((await request("tracker", create)).value, created.value);
    assert.equal(
      (await request("tracker", { ...create, locationId: 2 })).status,
      409,
    );
    assert.deepEqual(
      availableDashboardFocus(await run(listDashboards(agent.id)), []),
      ["all", "summary"],
    );
    for (const suffix of [
      "weather?key=weather",
      "weather?key=weather&blockId=items&refresh=1",
      "weather?key=weather&blockId=items&url=https://example.com",
      "weather?key=weather&key=other&blockId=items",
    ])
      assert.equal((await request(suffix)).status, 400);
    assert.equal(
      (await request("weather?key=weather&blockId=items", undefined, other.id))
        .status,
      400,
    );
    assert.equal(weatherCalls, 0);
    const weather = await request("weather?key=weather&blockId=items");
    assert.equal(weather.status, 200);
    assert.equal(weather.value.current.temperature, 20);
    assert.equal(weather.value.stale, false);
    const unit = {
      key: "weather",
      blockId: "items",
      expectedRevision: 1,
      id: randomUUID(),
      action: "set-weather-unit",
      unit: "fahrenheit",
    };
    const changed = await request("action", unit);
    assert.equal(changed.status, 200);
    assert.equal(changed.value.revision, 2);
    assert.deepEqual(
      (await request("action", unit)).value,
      changed.value,
      "lost unit response retries are idempotent",
    );
    assert.equal(
      (await request("action", { ...unit, unit: "celsius" })).status,
      409,
    );
    assert.equal(
      (await request("weather?key=weather&blockId=items")).value.unit,
      "fahrenheit",
    );
    assert.equal(
      (await request("tracker", create)).value.blocks[0].unit,
      "fahrenheit",
      "create retry preserves later unit edits",
    );

    const current = (await run(listDashboards(agent.id)))[0]!;
    await run(
      saveDashboard(agent.id, {
        key: current.key,
        title: current.title,
        expectedRevision: current.revision,
        blocks: [
          ...current.blocks,
          { type: "todo-list", id: "todos", items: [] },
        ],
      }),
    );
    t.mock.method(weatherProvider, "location", async () => {
      throw new Error("Offline");
    });
    const edited = await run(
      updateDashboardContent(agent.id, {
        key: "weather",
        expectedRevision: 3,
        blockId: "todos",
        action: "add-todo",
        id: randomUUID(),
        label: "Works offline",
      }),
    );
    assert.equal(edited.revision, 4);
    const switched = await run(
      updateDashboardContent(agent.id, {
        ...unit,
        action: "set-weather-unit",
        expectedRevision: 4,
        unit: "celsius",
      }),
    );
    assert.equal(switched.revision, 5);
    await assert.rejects(
      run(
        saveDashboard(agent.id, {
          key: "weather",
          title: current.title,
          expectedRevision: 5,
          blocks: [
            { type: "weather", id: "items", locationId: 2, unit: "celsius" },
          ],
        }),
      ),
      /validate this weather location/,
    );
    t.mock.method(
      weatherProvider,
      "location",
      provider.location.bind(provider),
    );
    const context = { agentId: agent.id, allowMutations: true };
    assert.equal(
      (
        await handleAgentTool(context, "roost_search_weather_locations", {
          query: "Test",
        })
      ).success,
      true,
    );
    assert.equal(
      (
        await handleAgentTool(context, "roost_create_weather_tracker", {
          key: "tool-weather",
          title: "Tool weather",
          locationId: 2,
          unit: "celsius",
        })
      ).success,
      true,
    );
    assert.equal(
      (
        await handleAgentTool(context, "roost_create_weather_tracker", {
          key: "bad",
          title: "Bad",
          locationId: 2,
          unit: "celsius",
          latitude: 0,
        })
      ).success,
      false,
    );

    // The read starts authorized, then the user's preference changes while
    // provider data is in flight. No report may escape the second ownership check.
    duringForecast = async () => {
      await run(setDashboardPreference(false));
    };
    await assert.rejects(
      run(
        getDashboardWeather(agent.id, {
          key: "tool-weather",
          blockId: "items",
        }),
      ),
      /Dashboards are off/,
    );
    await run(setDashboardPreference(true));
    duringForecast = undefined;
    disconnected = true;
    await assert.rejects(
      run(
        createDashboardTracker(agent.id, {
          ...create,
          key: "not-saved",
          kind: "weather",
          locationId: 3,
        }),
      ),
      /unavailable/,
    );
    assert.equal(
      (await run(listDashboards(agent.id))).some(
        (widget) => widget.key === "not-saved",
      ),
      false,
    );
    const canonical = await provider.location(1);
    let releaseLocation!: () => void;
    let locationStarted!: () => void;
    const waiting = new Promise<void>((resolve) => {
      locationStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLocation = resolve;
    });
    t.mock.method(weatherProvider, "location", async (id: number) => {
      locationStarted();
      await release;
      return { ...canonical, id };
    });
    const delayedSave = run(
      saveDashboard(agent.id, {
        key: "weather",
        title: "Stale replacement",
        expectedRevision: 5,
        blocks: [
          { type: "weather", id: "items", locationId: 4, unit: "celsius" },
        ],
      }),
    );
    await waiting;
    const newer = await run(
      updateDashboardContent(agent.id, {
        key: "weather",
        expectedRevision: 5,
        blockId: "todos",
        action: "add-todo",
        id: randomUUID(),
        label: "Keep concurrent edit",
      }),
    );
    releaseLocation();
    await assert.rejects(delayedSave, /dashboard changed/);
    assert.deepEqual(
      (await run(listDashboards(agent.id))).find(
        (widget) => widget.key === "weather",
      ),
      newer,
    );

    let releaseCreation!: () => void;
    let creationStarted!: () => void;
    const creating = new Promise<void>((resolve) => {
      creationStarted = resolve;
    });
    const allowCreation = new Promise<void>((resolve) => {
      releaseCreation = resolve;
    });
    t.mock.method(weatherProvider, "location", async (id: number) => {
      creationStarted();
      await allowCreation;
      return { ...canonical, id };
    });
    const delayedCreate = run(
      createDashboardTracker(agent.id, {
        ...create,
        kind: "weather",
        key: "disabled-race",
        locationId: 5,
      }),
    );
    await creating;
    await run(setDashboardPreference(false));
    releaseCreation();
    await assert.rejects(delayedCreate, /Dashboards are off/);
    await run(setDashboardPreference(true));
    assert.equal(
      (await run(listDashboards(agent.id))).some(
        (widget) => widget.key === "disabled-race",
      ),
      false,
    );
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1").run(),
      ),
    );
    assert.equal((await request("weather/locations?query=Other")).status, 400);
  } finally {
    tokens.close();
    if (old === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = old;
    rmSync(directory, { recursive: true, force: true });
  }
});
