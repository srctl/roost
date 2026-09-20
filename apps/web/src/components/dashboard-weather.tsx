import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  changeDashboardContent,
  getDashboardWeather,
} from "../features/dashboards/functions";
import type {
  DashboardBlock,
  DashboardWidget,
} from "../features/dashboards/schema";
import type { WeatherReport } from "../features/dashboards/weather";
import {
  weatherCondition,
  weatherDay,
} from "../features/dashboards/weather-display";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

function WeatherSymbol({
  code,
  isDay = true,
}: {
  code: number;
  isDay?: boolean;
}) {
  const cloud = code >= 2;
  const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
  return (
    <svg
      aria-hidden="true"
      width="44"
      height="44"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {!cloud &&
        (isDay ? (
          <>
            <circle cx="24" cy="24" r="9" />
            <path d="M24 4v5m0 30v5M4 24h5m30 0h5M10 10l4 4m20 20 4 4M10 38l4-4m20-20 4-4" />
          </>
        ) : (
          <path d="M35 31A16 16 0 0 1 17 8a16 16 0 1 0 18 23Z" />
        ))}
      {cloud && (
        <path d="M12 31a8 8 0 0 1-1-16 12 12 0 0 1 23-1 9 9 0 0 1 1 18H12Z" />
      )}
      {rain && <path d="m15 37-2 5m11-5-2 5m11-5-2 5" />}
      {snow && <path d="M15 37v7m-3-3h6m12-4v7m-3-3h6" />}
      {code >= 95 && <path d="m25 29-7 9h7l-3 8" />}
      {(code === 45 || code === 48) && <path d="M10 38h28M15 44h20" />}
    </svg>
  );
}

export function DashboardWeather({
  block,
  widget,
  onChange,
  onReload,
}: {
  block: Extract<DashboardBlock, { type: "weather" }>;
  widget: DashboardWidget;
  onChange: (widget: DashboardWidget) => void;
  onReload: () => Promise<void>;
}) {
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const request = useRef(0);
  const { agentId, key } = widget;
  const { id, locationId, unit } = block;
  const load = useCallback(
    async (refresh = false) => {
      const version = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const result = await getDashboardWeather({
          data: { agentId, key, blockId: id, refresh },
        });
        if (version !== request.current) return;
        if (result.ok) {
          if (
            result.value.unit !== unit ||
            result.value.location.id !== locationId
          ) {
            setError(
              "Weather settings changed. Reload the tracker to see its current forecast.",
            );
          } else setReport(result.value);
        } else setError(result.error);
      } catch {
        if (version === request.current)
          setError("Weather could not be updated. Try again in a moment.");
      } finally {
        if (version === request.current) setLoading(false);
      }
    },
    [agentId, key, id, locationId, unit],
  );
  useEffect(() => {
    setReport(null);
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(refresh, 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      request.current++;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, locationId, unit]);

  async function changeUnit(next: "celsius" | "fahrenheit") {
    if (saving || next === unit) return;
    setSaving(true);
    setError(null);
    try {
      const result = await changeDashboardContent({
        data: {
          key,
          expectedRevision: widget.revision,
          blockId: id,
          id: crypto.randomUUID(),
          action: "set-weather-unit",
          unit: next,
          agentId,
        },
      });
      if (result.ok) onChange(result.value);
      else {
        setError(result.error);
        await onReload();
      }
    } catch {
      setError(
        "Could not confirm the temperature setting. Refresh to check it.",
      );
      await onReload().catch(() => {});
    } finally {
      setSaving(false);
    }
  }

  // Never display a previous city's forecast or a previous unit after a config change.
  const expired =
    report && Date.now() - Date.parse(report.updatedAt) > 24 * 60 * 60 * 1000;
  const data =
    report?.unit === unit && report.location.id === locationId && !expired
      ? report
      : null;
  const degrees = (value: number) => `${Math.round(value)}°`;
  const suffix = unit === "celsius" ? "C" : "F";
  const today =
    data &&
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: data.location.timezone,
    }).format(new Date());
  const updated =
    data &&
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: data.location.timezone,
    }).format(new Date(data.updatedAt));
  const observed =
    data &&
    new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: data.location.timezone,
    }).format(new Date(data.observedAt));
  return (
    <section
      aria-label="Weather"
      aria-busy={loading || saving}
      {...stylex.props(styles.container)}
    >
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.place)}>
          {data ? (
            <>
              <strong>{data.location.name}</strong>
              <span {...stylex.props(styles.muted)}>
                {[data.location.region, data.location.country]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </>
          ) : (
            <span {...stylex.props(styles.muted)}>
              {loading ? "Loading forecast…" : "Weather forecast"}
            </span>
          )}
        </div>
        <fieldset aria-label="Temperature unit" {...stylex.props(styles.units)}>
          <Button
            aria-label="Celsius"
            aria-pressed={unit === "celsius"}
            disabled={saving}
            onClick={() => void changeUnit("celsius")}
            xstyle={unit === "celsius" && styles.selected}
          >
            °C
          </Button>
          <Button
            aria-label="Fahrenheit"
            aria-pressed={unit === "fahrenheit"}
            disabled={saving}
            onClick={() => void changeUnit("fahrenheit")}
            xstyle={unit === "fahrenheit" && styles.selected}
          >
            °F
          </Button>
        </fieldset>
      </div>
      {data && (
        <>
          <div {...stylex.props(styles.current)}>
            <output
              {...stylex.props(styles.temperature)}
              aria-label={`${Math.round(data.current.temperature)} degrees ${unit}`}
            >
              {degrees(data.current.temperature)}
              <span {...stylex.props(styles.degreeUnit)}>{suffix}</span>
            </output>
            <div {...stylex.props(styles.condition)}>
              <WeatherSymbol
                code={data.current.weatherCode}
                isDay={data.current.isDay}
              />
              <span>{weatherCondition(data.current.weatherCode)}</span>
            </div>
          </div>
          <p {...stylex.props(styles.details)}>
            Feels like {degrees(data.current.feelsLike)} · Wind{" "}
            {Math.round(data.current.windSpeed)} km/h
          </p>
          <table
            aria-label={
              data.days.length === 5
                ? "Five-day forecast"
                : `${data.days.length}-day forecast`
            }
            {...stylex.props(styles.forecast)}
          >
            <thead {...stylex.props(styles.head)}>
              <tr>
                <th scope="col" {...stylex.props(styles.cell)}>
                  Day
                </th>
                <th scope="col" {...stylex.props(styles.cell)}>
                  Conditions
                </th>
                <th scope="col" {...stylex.props(styles.cell)}>
                  <abbr title="Chance of precipitation">Precip.</abbr>
                </th>
                <th scope="col" {...stylex.props(styles.cell, styles.highLow)}>
                  High / low
                </th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <tr key={day.date}>
                  <th scope="row" {...stylex.props(styles.cell)}>
                    <time dateTime={day.date} title={day.date}>
                      {day.date === today ? "Today" : weatherDay(day.date)}
                    </time>
                  </th>
                  <td {...stylex.props(styles.cell)}>
                    {weatherCondition(day.weatherCode)}
                  </td>
                  <td {...stylex.props(styles.cell)}>
                    {Math.round(day.precipitationProbability)}%
                  </td>
                  <td {...stylex.props(styles.cell, styles.highLow)}>
                    {degrees(day.high)}{" "}
                    <span {...stylex.props(styles.muted)}>
                      / {degrees(day.low)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data.stale ||
            data.notice ||
            Date.now() - Date.parse(data.updatedAt) > 15 * 60 * 1000) && (
            <p role="status" {...stylex.props(styles.notice)}>
              {data.notice ||
                "Showing the last available forecast. Refresh to try again."}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.notice)}>
          {error}
          {data && " Showing the last loaded forecast."}
          <Button onClick={() => void onReload().catch(() => {})}>
            Reload tracker
          </Button>
        </p>
      )}
      {expired && !error && (
        <p role="status" {...stylex.props(styles.notice)}>
          This forecast has expired. Refresh to load current weather.
        </p>
      )}
      <div {...stylex.props(styles.footer)}>
        <div {...stylex.props(styles.source)}>
          {observed && <span>Conditions at {observed}</span>}
          {updated && <span>Updated {updated}</span>}
          <a
            href="https://open-meteo.com/"
            target="_blank"
            rel="noreferrer"
            {...stylex.props(styles.link)}
          >
            Weather by Open-Meteo ↗
          </a>
        </div>
        <Button
          disabled={loading || saving}
          aria-label="Refresh weather"
          onClick={() => void load(true)}
        >
          {loading ? "Updating…" : "Refresh"}
        </Button>
      </div>
    </section>
  );
}

const styles = stylex.create({
  container: { minWidth: 0, width: "100%", maxWidth: 560 },
  toolbar: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  place: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 13,
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  muted: { color: colors.muted },
  units: {
    display: "flex",
    gap: 2,
    flexShrink: 0,
    borderWidth: 0,
    padding: 0,
    margin: 0,
    minWidth: 0,
  },
  selected: { color: colors.foreground, backgroundColor: colors.selected },
  current: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginTop: 20,
    marginBottom: 4,
  },
  temperature: {
    fontSize: 56,
    lineHeight: 1.1,
    letterSpacing: "-0.04em",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  degreeUnit: { fontSize: 24, color: colors.muted, letterSpacing: 0 },
  condition: {
    display: "flex",
    alignItems: "flex-end",
    flexDirection: "column",
    gap: 4,
    fontSize: 12,
    color: colors.muted,
    textAlign: "right",
  },
  details: {
    fontSize: 12,
    lineHeight: 1.6,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 20,
  },
  forecast: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
    lineHeight: 1.5,
    fontVariantNumeric: "tabular-nums",
    textAlign: "left",
  },
  head: { color: colors.muted, fontSize: 11 },
  cell: {
    fontWeight: 400,
    paddingBlock: 8,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  highLow: { whiteSpace: "nowrap", textAlign: "right", paddingRight: 0 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 14,
  },
  source: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 11,
    color: colors.muted,
  },
  link: { color: colors.muted, textUnderlineOffset: 3 },
  notice: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.6,
    marginTop: 12,
    marginBottom: 0,
  },
});
