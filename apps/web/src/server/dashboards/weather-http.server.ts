import { Schema } from "effect";
import {
  WeatherLocationId,
  WeatherUnit,
} from "../../features/dashboards/schema";
import {
  decodeWeatherSearch,
  WeatherLocation,
} from "../../features/dashboards/weather";
import type { WeatherTransport } from "./weather-provider.server";

const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const unavailable = () =>
  new Error("Weather is temporarily unavailable. Try again shortly.");

/** Only chosen city searches and canonical public coordinates leave the server. */
export function createOpenMeteoTransport(
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): WeatherTransport {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = Math.max(
    1,
    Math.min(options.timeoutMs ?? REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS),
  );

  async function request(
    service: "geocoding" | "forecast",
    path: "/v1/search" | "/v1/get" | "/v1/forecast",
    params: Record<string, string>,
  ): Promise<unknown> {
    const host =
      service === "geocoding"
        ? "geocoding-api.open-meteo.com"
        : "api.open-meteo.com";
    const url = new URL(path, `https://${host}`);
    for (const [name, value] of Object.entries(params))
      url.searchParams.set(name, value);
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            redirect: "error",
            credentials: "omit",
            signal: controller.signal,
          });
          if (
            controller.signal.aborted ||
            !response.ok ||
            response.redirected ||
            (response.url && new URL(response.url).origin !== url.origin) ||
            !response.body
          )
            throw unavailable();
          const declaredLength = response.headers.get("content-length");
          if (
            declaredLength !== null &&
            Number(declaredLength) > MAX_RESPONSE_BYTES
          )
            throw unavailable();
          reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          let bytes = 0;
          let body = "";
          while (true) {
            const next = await reader.read();
            if (controller.signal.aborted) throw unavailable();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw unavailable();
            body += decoder.decode(next.value, { stream: true });
          }
          return JSON.parse(body + decoder.decode());
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(unavailable());
          }, timeoutMs);
        }),
      ]);
    } catch {
      // Provider error bodies and network diagnostics never reach clients.
      throw unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
  }

  async function validated<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch {
      throw unavailable();
    }
  }

  return {
    search: (query) =>
      validated(() =>
        request("geocoding", "/v1/search", {
          name: decodeWeatherSearch({ query }).query,
          count: "5",
          language: "en",
          format: "json",
        }),
      ),
    location: (id) =>
      validated(() =>
        request("geocoding", "/v1/get", {
          id: String(Schema.decodeUnknownSync(WeatherLocationId)(id)),
        }),
      ),
    forecast: (location, unit) =>
      validated(() => {
        const canonical = Schema.decodeUnknownSync(WeatherLocation)(location);
        return request("forecast", "/v1/forecast", {
          latitude: String(canonical.latitude),
          longitude: String(canonical.longitude),
          timezone: canonical.timezone,
          temperature_unit: Schema.decodeUnknownSync(WeatherUnit)(unit),
          wind_speed_unit: "kmh",
          current:
            "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m",
          daily:
            "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
          forecast_days: "5",
          timeformat: "unixtime",
        });
      }),
  };
}
