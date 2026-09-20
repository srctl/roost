// Test-only local transport for the disposable browser build. No provider network calls.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = process.env.ROOST_DATA_DIR;
if (
  !directory ||
  readFileSync(join(directory, "weather-fixture"), "utf8") !== "weather-browser"
) {
  throw new Error(
    "Weather provider fixture requires its disposable test directory",
  );
}
const control = () => {
  try {
    return JSON.parse(
      readFileSync(join(directory, "weather-control.json"), "utf8"),
    );
  } catch {
    return {};
  }
};
const nativeNow = Date.now;
Date.now = () => nativeNow() + (control().clockOffsetMs ?? 0);
const nativeFetch = globalThis.fetch;
const locations = [
  {
    id: 5809844,
    name: "Seattle",
    admin1: "Washington",
    country: "United States",
    latitude: 47.60621,
    longitude: -122.33207,
    timezone: "America/Los_Angeles",
  },
  {
    id: 5128581,
    name: "New York",
    admin1: "New York",
    country: "United States",
    latitude: 40.71427,
    longitude: -74.00597,
    timezone: "America/New_York",
  },
];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(
      `External network is disabled in the weather fixture: ${url.hostname}`,
    );
  }
  return nativeFetch(input, init);
};
const record = (method, arguments_) =>
  appendFileSync(
    join(directory, "weather-requests.jsonl"),
    `${JSON.stringify({ method, arguments: arguments_ })}\n`,
  );
export const weatherTransport = {
  search: async (query) => {
    record("search", { query });
    return {
      results: locations.filter((item) =>
        item.name.toLowerCase().includes(query.toLowerCase()),
      ),
    };
  },
  location: async (id) => {
    record("location", { id });
    const location = locations.find((item) => item.id === id);
    if (!location) throw new Error("Unknown fixture location");
    return location;
  },
  forecast: async (location, selectedUnit) => {
    record("forecast", { locationId: location.id, unit: selectedUnit });
    if (control().failForecast)
      throw new Error("Fixture weather provider unavailable");
    const fahrenheit = selectedUnit === "fahrenheit";
    const temperature = (celsius) =>
      fahrenheit ? Math.round((celsius * 9) / 5 + 32) : celsius;
    const unit = fahrenheit ? "°F" : "°C";
    const offset = (location.id === 5128581 ? -4 : -7) * 3600;
    const now = Math.floor(Date.now() / 1000);
    const midnight = Math.floor((now + offset) / 86400) * 86400 - offset;
    const days = 5;
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
      utc_offset_seconds: offset,
      current_units: {
        temperature_2m: unit,
        apparent_temperature: unit,
        wind_speed_10m: "km/h",
      },
      daily_units: { temperature_2m_max: unit, temperature_2m_min: unit },
      current: {
        time: now,
        temperature_2m: temperature(20),
        apparent_temperature: temperature(19),
        weather_code: 2,
        is_day: 1,
        wind_speed_10m: 12,
      },
      daily: {
        time: Array.from({ length: days }, (_, i) => midnight + i * 86400),
        weather_code: [2, 3, 61, 3, 2, 0, 1].slice(0, days),
        temperature_2m_max: [21, 22, 19, 20, 21, 24, 23]
          .slice(0, days)
          .map(temperature),
        temperature_2m_min: [12, 13, 11, 12, 12, 13, 14]
          .slice(0, days)
          .map(temperature),
        precipitation_probability_max: [10, 25, 80, 40, 10, 0, 5].slice(
          0,
          days,
        ),
      },
    };
  },
};
globalThis.__roostWeatherTestTransport = weatherTransport;
