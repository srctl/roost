import { Schema } from "effect";
import { z } from "zod";
import type { WeatherUnit } from "../../features/dashboards/schema";
import {
  WeatherLocation,
  WeatherReport,
} from "../../features/dashboards/weather";
import { createOpenMeteoTransport } from "./weather-http.server";

const MINUTE = 60_000;
const FORECAST_TTL = 15 * MINUTE;
const MAX_STALE = 24 * 60 * MINUTE;
const label = z.string().min(1).max(200);
const locationSchema = z.object({
  id: z.number().int().min(1).max(2147483647),
  name: label,
  admin1: label.optional(),
  country: label.optional(),
  country_code: label.optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: label,
});
const epoch = z.number().int().min(0).max(4102444800);
const number = z.number().finite();
const values = z.array(number).min(1).max(7);
const forecastSchema = z.object({
  utc_offset_seconds: z.number().int().min(-50400).max(50400),
  current_units: z.object({
    temperature_2m: label,
    apparent_temperature: label,
    wind_speed_10m: label,
  }),
  daily_units: z.object({
    temperature_2m_max: label,
    temperature_2m_min: label,
  }),
  current: z.object({
    time: epoch,
    temperature_2m: number,
    apparent_temperature: number,
    weather_code: number,
    is_day: z.union([z.literal(0), z.literal(1)]),
    wind_speed_10m: number,
  }),
  daily: z.object({
    time: z.array(epoch).min(1).max(7),
    weather_code: values,
    temperature_2m_max: values,
    temperature_2m_min: values,
    precipitation_probability_max: values,
  }),
});

export class WeatherUnavailable extends Error {
  constructor(
    message = "Weather is temporarily unavailable. Try again shortly.",
  ) {
    super(message);
  }
}

export type WeatherTransport = {
  search: (query: string) => Promise<unknown>;
  location: (id: number) => Promise<unknown>;
  forecast: (location: WeatherLocation, unit: WeatherUnit) => Promise<unknown>;
};

function locationFromProvider(input: unknown): WeatherLocation {
  const value = locationSchema.parse(input);
  return Schema.decodeUnknownSync(WeatherLocation)({
    id: value.id,
    name: value.name,
    region: value.admin1 ?? "",
    country: value.country ?? value.country_code,
    latitude: value.latitude,
    longitude: value.longitude,
    timezone: value.timezone,
  });
}

function localDate(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const part = (name: string) =>
    parts.find((part) => part.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Provider-owned data stays outside saved widgets and agent-authored content. */
export class WeatherProvider {
  private readonly transport: WeatherTransport;
  private readonly now: () => number;
  private readonly entries = new Map<
    string,
    { value: unknown; at: number; failed?: boolean }
  >();
  private readonly attempts = new Map<string, number>();
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    options: { transport?: WeatherTransport; now?: () => number } = {},
  ) {
    this.transport = options.transport ?? createOpenMeteoTransport();
    this.now = options.now ?? (() => Date.now());
  }

  private remember(key: string, value: unknown, at = this.now()) {
    this.entries.delete(key);
    this.entries.set(key, { value, at });
    while (this.entries.size > 256)
      this.entries.delete(this.entries.keys().next().value!);
  }
  private attempt(key: string) {
    this.attempts.set(key, this.now());
    while (this.attempts.size > 512)
      this.attempts.delete(this.attempts.keys().next().value!);
  }
  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    if (this.pending.size >= 8)
      return Promise.reject(
        new WeatherUnavailable("Weather is busy. Try again in a minute."),
      );
    const promise = load();
    this.pending.set(key, promise);
    void promise
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      })
      .catch(() => {});
    return promise;
  }
  private cached<T>(
    key: string,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && this.now() - cached.at < ttl)
      return Promise.resolve(cached.value as T);
    return this.once(key, async () => {
      if (this.now() - (this.attempts.get(key) ?? -Infinity) < MINUTE)
        throw new WeatherUnavailable();
      this.attempt(key);
      try {
        const value = await load();
        this.remember(key, value);
        return value;
      } catch (error) {
        throw error instanceof WeatherUnavailable
          ? error
          : new WeatherUnavailable();
      }
    });
  }

  search(query: string): Promise<readonly WeatherLocation[]> {
    return this.cached(
      `search:${query.toLowerCase()}`,
      60 * MINUTE,
      async () => {
        const raw = z
          .object({
            results: z.array(z.unknown()).max(5).optional(),
            error: z.literal(false).optional(),
          })
          .parse(await this.transport.search(query));
        const locations = (raw.results ?? []).map(locationFromProvider);
        return locations.filter(
          (location, index) =>
            locations.findIndex((item) => item.id === location.id) === index,
        );
      },
    );
  }
  location(id: number): Promise<WeatherLocation> {
    return this.cached(`location:${id}`, MAX_STALE, async () => {
      const location = locationFromProvider(await this.transport.location(id));
      if (location.id !== id) throw new WeatherUnavailable();
      return location;
    });
  }
  forecast(
    id: number,
    unit: WeatherUnit,
    refresh = false,
  ): Promise<WeatherReport> {
    const key = `forecast:${id}:${unit}`;
    const cached = this.entries.get(key);
    const recentAttempt =
      this.now() - (this.attempts.get(key) ?? -Infinity) < MINUTE;
    const fallback = (): WeatherReport => {
      if (!cached || this.now() - cached.at > MAX_STALE)
        throw new WeatherUnavailable();
      const stale = !!cached.failed || this.now() - cached.at >= FORECAST_TTL;
      return {
        ...(cached.value as WeatherReport),
        stale,
        notice: stale
          ? "Could not refresh weather. Showing the last available forecast."
          : null,
      };
    };
    if (
      cached &&
      ((!refresh && this.now() - cached.at < FORECAST_TTL) || recentAttempt)
    )
      return Promise.resolve(fallback());
    return this.once(key, async () => {
      if (recentAttempt) throw new WeatherUnavailable();
      this.attempt(key);
      try {
        const location = await this.location(id);
        const raw = forecastSchema.parse(
          await this.transport.forecast(location, unit),
        );
        const symbol = unit === "celsius" ? "°C" : "°F";
        if (
          raw.current_units.temperature_2m !== symbol ||
          raw.current_units.apparent_temperature !== symbol ||
          raw.daily_units.temperature_2m_max !== symbol ||
          raw.daily_units.temperature_2m_min !== symbol ||
          raw.current_units.wind_speed_10m !== "km/h" ||
          Object.values(raw.daily).some(
            (values) => values.length !== raw.daily.time.length,
          )
        )
          throw new WeatherUnavailable();
        const report = Schema.decodeUnknownSync(WeatherReport)({
          location,
          unit,
          updatedAt: new Date(this.now()).toISOString(),
          observedAt: new Date(raw.current.time * 1000).toISOString(),
          current: {
            temperature: raw.current.temperature_2m,
            feelsLike: raw.current.apparent_temperature,
            weatherCode: raw.current.weather_code,
            isDay: raw.current.is_day === 1,
            windSpeed: raw.current.wind_speed_10m,
          },
          days: raw.daily.time.map((time, index) => ({
            date: localDate(time * 1000, location.timezone),
            weatherCode: raw.daily.weather_code[index],
            high: raw.daily.temperature_2m_max[index],
            low: raw.daily.temperature_2m_min[index],
            precipitationProbability:
              raw.daily.precipitation_probability_max[index],
          })),
          stale: false,
          notice: null,
        });
        if (report.days[0]?.date !== localDate(this.now(), location.timezone))
          throw new WeatherUnavailable();
        this.remember(key, report);
        return report;
      } catch (error) {
        if (cached) cached.failed = true;
        if (!cached && error instanceof WeatherUnavailable) throw error;
        return fallback();
      }
    });
  }
}

export const weatherProvider = new WeatherProvider();
