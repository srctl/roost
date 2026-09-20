import assert from "node:assert/strict";
import { test } from "node:test";
import type { WeatherUnit } from "../src/features/dashboards/schema";
import type { WeatherLocation } from "../src/features/dashboards/weather";
import { createOpenMeteoTransport } from "../src/server/dashboards/weather-http.server";
import { WeatherProvider } from "../src/server/dashboards/weather-provider.server";

const location: WeatherLocation = {
  id: 5809844,
  name: "Seattle",
  region: "Washington",
  country: "United States",
  latitude: 47.60621,
  longitude: -122.33207,
  timezone: "America/Los_Angeles",
};
const unavailable = "Weather is temporarily unavailable. Try again shortly.";

test("weather HTTP sends only the bounded city, canonical ID, or forecast parameters to fixed public hosts", async () => {
  const requests: { url: URL; init: RequestInit }[] = [];
  const transport = createOpenMeteoTransport({
    fetch: async (input, init) => {
      assert(input instanceof URL);
      requests.push({ url: input, init: init! });
      return Response.json({ ok: true });
    },
  });
  assert.deepEqual(await transport.search("  Seattle  "), { ok: true });
  await transport.location(location.id);
  await transport.forecast(location, "fahrenheit");
  assert.deepEqual(
    requests.map(({ url }) => `${url.origin}${url.pathname}`),
    [
      "https://geocoding-api.open-meteo.com/v1/search",
      "https://geocoding-api.open-meteo.com/v1/get",
      "https://api.open-meteo.com/v1/forecast",
    ],
  );
  assert.deepEqual(Object.fromEntries(requests[0]!.url.searchParams), {
    name: "Seattle",
    count: "5",
    language: "en",
    format: "json",
  });
  assert.deepEqual(Object.fromEntries(requests[1]!.url.searchParams), {
    id: "5809844",
  });
  assert.deepEqual(Object.fromEntries(requests[2]!.url.searchParams), {
    latitude: "47.60621",
    longitude: "-122.33207",
    timezone: "America/Los_Angeles",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "kmh",
    current:
      "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "5",
    timeformat: "unixtime",
  });
  for (const { init } of requests) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.deepEqual(init.headers, { Accept: "application/json" });
    assert.equal(init.body, undefined);
    assert(init.signal instanceof AbortSignal);
  }
});

test("weather HTTP rejects invalid inputs before fetching", async () => {
  let calls = 0;
  const transport = createOpenMeteoTransport({
    fetch: async () => {
      calls += 1;
      return Response.json({});
    },
  });
  const invalid = [
    () => transport.search("x"),
    () => transport.search(" "),
    () => transport.search("a".repeat(101)),
    () => transport.location(0),
    () => transport.location(1.5),
    () => transport.location(2147483648),
    () => transport.forecast({ ...location, latitude: Infinity }, "celsius"),
    () => transport.forecast({ ...location, longitude: 181 }, "celsius"),
    () => transport.forecast({ ...location, timezone: "Invalid" }, "celsius"),
    () => transport.forecast(location, "kelvin" as WeatherUnit),
  ];
  for (const call of invalid)
    await assert.rejects(call, { message: unavailable });
  assert.equal(calls, 0);
});

test("weather HTTP bounds declared and streamed bytes and rejects malformed responses", async () => {
  let cancelled = false;
  const cases: (() => Response)[] = [
    () =>
      new Response("{}", {
        headers: { "content-length": String(128 * 1024 + 1) },
      }),
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024));
            controller.enqueue(new Uint8Array(64 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    () => new Response("not JSON: sensitive upstream details"),
    () => new Response(new Uint8Array([0xff, 0xfe])),
    () => new Response(null, { status: 204 }),
    () => new Response("sensitive upstream details", { status: 503 }),
    () => Response.redirect("https://unexpected.example", 302),
    () => {
      const response = Response.json({});
      Object.defineProperty(response, "url", {
        value: "https://unexpected.example/v1/search",
      });
      return response;
    },
    () => {
      const response = Response.json({});
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
  ];
  for (const response of cases) {
    const transport = createOpenMeteoTransport({
      fetch: async () => response(),
    });
    await assert.rejects(transport.search("Seattle"), { message: unavailable });
  }
  assert.equal(cancelled, true, "oversized streams are cancelled");
  const limit = createOpenMeteoTransport({
    fetch: async () => new Response(`"${"x".repeat(128 * 1024 - 2)}"`),
  });
  assert.equal(
    ((await limit.search("Seattle")) as string).length,
    128 * 1024 - 2,
  );
});

test("weather HTTP times out fetch and response streaming and strips transport diagnostics", async () => {
  let signal: AbortSignal | null | undefined;
  const stalledFetch = createOpenMeteoTransport({
    timeoutMs: 20,
    fetch: async (_, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    },
  });
  await assert.rejects(stalledFetch.search("Seattle"), {
    message: unavailable,
  });
  assert.equal(signal?.aborted, true);
  let cancelled = false;
  const stalledBody = createOpenMeteoTransport({
    timeoutMs: 20,
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(stalledBody.search("Seattle"), { message: unavailable });
  assert.equal(cancelled, true);
  const failed = createOpenMeteoTransport({
    fetch: async () => {
      throw new Error("sensitive network diagnostics");
    },
  });
  await assert.rejects(failed.search("Seattle"), (error: Error) => {
    assert.equal(error.message, unavailable);
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.stack!, /sensitive/);
    return true;
  });
});

test("the default provider uses the approved HTTP adapter while remaining locally testable", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: URL) => {
    calls += 1;
    assert.equal(input.host, "geocoding-api.open-meteo.com");
    return Response.json({
      results: [{ ...location, admin1: location.region }],
    });
  });
  const provider = new WeatherProvider();
  const result = await provider.search("Seattle");
  assert.deepEqual(result, [location]);
  assert.deepEqual(await provider.search("Seattle"), result);
  assert.equal(calls, 1);
});
