import { Schema } from "effect";
import {
  DashboardDate,
  DashboardKey,
  WeatherLocationId,
  WeatherUnit,
} from "./schema";

export { WeatherUnit } from "./schema";

const label = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));
const temperature = Schema.Finite.pipe(Schema.between(-300, 300));
export const WeatherLocation = Schema.Struct({
  id: WeatherLocationId,
  name: label,
  region: Schema.String.pipe(Schema.maxLength(200)),
  country: label,
  latitude: Schema.Finite.pipe(Schema.between(-90, 90)),
  longitude: Schema.Finite.pipe(Schema.between(-180, 180)),
  timezone: label.pipe(
    Schema.filter(
      (value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      },
      { message: () => "Use a valid location timezone." },
    ),
  ),
});
export type WeatherLocation = typeof WeatherLocation.Type;
export const WeatherCode = Schema.Literal(
  0,
  1,
  2,
  3,
  45,
  48,
  51,
  53,
  55,
  56,
  57,
  61,
  63,
  65,
  66,
  67,
  71,
  73,
  75,
  77,
  80,
  81,
  82,
  85,
  86,
  95,
  96,
  99,
);
const instant = Schema.String.pipe(
  Schema.pattern(/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.filter(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  ),
);
export const WeatherReport = Schema.Struct({
  location: WeatherLocation,
  unit: WeatherUnit,
  updatedAt: instant,
  observedAt: instant,
  current: Schema.Struct({
    temperature,
    feelsLike: temperature,
    weatherCode: WeatherCode,
    isDay: Schema.Boolean,
    windSpeed: Schema.Finite.pipe(Schema.between(0, 500)),
  }),
  days: Schema.Array(
    Schema.Struct({
      date: DashboardDate,
      weatherCode: WeatherCode,
      high: temperature,
      low: temperature,
      precipitationProbability: Schema.Finite.pipe(Schema.between(0, 100)),
    }),
  ).pipe(Schema.minItems(1), Schema.maxItems(7)),
  stale: Schema.Boolean,
  notice: Schema.NullOr(Schema.String),
}).pipe(
  Schema.filter(
    (report) =>
      Math.abs(Date.parse(report.observedAt) - Date.parse(report.updatedAt)) <=
        3 * 60 * 60_000 &&
      report.days.every(
        (day, index) =>
          day.low <= day.high &&
          (index === 0 || day.date > report.days[index - 1]!.date),
      ),
    {
      message: () =>
        "Weather requires current timestamps and ordered daily ranges.",
    },
  ),
);
export type WeatherReport = typeof WeatherReport.Type;

export const WeatherSearch = Schema.Struct({
  query: Schema.Trim.pipe(Schema.minLength(2), Schema.maxLength(100)),
});
export const DashboardWeatherInput = Schema.Struct({
  key: DashboardKey,
  blockId: DashboardKey,
  refresh: Schema.optional(Schema.Boolean),
});
export type DashboardWeatherInput = typeof DashboardWeatherInput.Type;
export const decodeWeatherSearch = Schema.decodeUnknownSync(WeatherSearch, {
  onExcessProperty: "error",
});
export const decodeDashboardWeatherInput = Schema.decodeUnknownSync(
  DashboardWeatherInput,
  { onExcessProperty: "error" },
);
