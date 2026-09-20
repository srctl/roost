import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { CreateDashboardTracker } from "../features/dashboards/actions";
import {
  createDashboardTracker,
  searchWeatherLocations,
} from "../features/dashboards/functions";
import type { WeatherLocation } from "../features/dashboards/weather";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

export function CreateTracker({
  agentId,
  onCreated,
}: {
  agentId: string;
  onCreated: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [kind, setKind] = useState<"todo" | "calories" | "weather">("todo");
  const [location, setLocation] = useState<WeatherLocation | null>(null);
  const [unit, setUnit] = useState<"celsius" | "fahrenheit">("celsius");
  const [title, setTitle] = useState("To-do list");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState<CreateDashboardTracker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  return (
    <div {...stylex.props(styles.container)}>
      <Button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={saving || !hydrated}
      >
        Add tracker
      </Button>
      {open && (
        <form
          aria-label="New tracker"
          {...stylex.props(styles.form)}
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              !title.trim() ||
              saving ||
              (kind === "weather" && !location && !retry)
            )
              return;
            key.current ??= `${kind}-${crypto.randomUUID()}`;
            setSaving(true);
            setError(null);
            const input: CreateDashboardTracker =
              retry ??
              (kind === "weather" && location
                ? {
                    key: key.current,
                    kind: "weather",
                    title: title.trim(),
                    locationId: location.id,
                    unit,
                  }
                : {
                    key: key.current,
                    kind: kind === "calories" ? "calories" : "todo",
                    title: title.trim(),
                  });
            try {
              const result = await createDashboardTracker({
                data: { agentId, ...input },
              });
              setRetry(null);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              // Creation has succeeded even if refreshing the surrounding dashboard fails.
              key.current = null;
              setOpen(false);
              const notice = await onCreated().catch(
                () => "Tracker created. Refresh the dashboard to see it.",
              );
              if (notice) setError(notice);
            } catch {
              setRetry(input);
              setError(
                "Could not confirm the new tracker. Try again to check it.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <label {...stylex.props(styles.field)}>
            Type
            <select
              aria-label="Tracker type"
              value={kind}
              disabled={saving || retry !== null}
              {...stylex.props(styles.input)}
              onChange={(event) => {
                const next = event.target.value as
                  | "todo"
                  | "calories"
                  | "weather";
                setKind(next);
                setTitle(
                  next === "todo"
                    ? "To-do list"
                    : next === "calories"
                      ? "Calorie log"
                      : "Weather",
                );
                key.current = null;
              }}
            >
              <option value="todo">To-do list</option>
              <option value="calories">Calorie log</option>
              <option value="weather">Weather</option>
            </select>
          </label>
          <label {...stylex.props(styles.field, styles.name)}>
            Name
            <input
              aria-label="Tracker name"
              value={title}
              maxLength={100}
              disabled={saving || retry !== null}
              onChange={(event) => setTitle(event.target.value)}
              {...stylex.props(styles.input)}
            />
          </label>
          {kind === "weather" && (
            <WeatherLocationPicker
              agentId={agentId}
              disabled={saving || retry !== null}
              selected={location}
              onSelect={setLocation}
              unit={unit}
              onUnitChange={setUnit}
            />
          )}
          <Button
            type="submit"
            disabled={
              saving || !title.trim() || (kind === "weather" && !location)
            }
            xstyle={styles.create}
          >
            {saving ? "Creating…" : retry ? "Retry creation" : "Create tracker"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

function WeatherLocationPicker({
  agentId,
  disabled,
  selected,
  onSelect,
  unit,
  onUnitChange,
}: {
  agentId: string;
  disabled: boolean;
  selected: WeatherLocation | null;
  onSelect: (location: WeatherLocation | null) => void;
  unit: "celsius" | "fahrenheit";
  onUnitChange: (unit: "celsius" | "fahrenheit") => void;
}) {
  const [query, setQuery] = useState("");
  const [locations, setLocations] = useState<readonly WeatherLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function search() {
    if (disabled || query.trim().length < 2) return;
    const version = ++request.current;
    setLoading(true);
    setNotice(null);
    setLocations([]);
    onSelect(null);
    try {
      const result = await searchWeatherLocations({
        data: { agentId, query: query.trim() },
      });
      if (version !== request.current) return;
      if (result.ok) {
        setLocations(result.value);
        if (!result.value.length)
          setNotice(
            "No matching cities. Try a nearby city or add the country.",
          );
      } else setNotice(result.error);
    } catch {
      if (version === request.current)
        setNotice("Could not search for cities. Try again.");
    } finally {
      if (version === request.current) setLoading(false);
    }
  }
  return (
    <div {...stylex.props(styles.weather)}>
      <p {...stylex.props(styles.error)}>
        Search for a city with Open-Meteo to load its forecast.
      </p>
      <div {...stylex.props(styles.search)}>
        <label {...stylex.props(styles.field, styles.city)}>
          City
          <input
            aria-label="Weather city"
            placeholder="City or postal code"
            maxLength={100}
            value={query}
            disabled={disabled}
            {...stylex.props(styles.input)}
            onChange={(event) => {
              request.current++;
              setQuery(event.target.value);
              onSelect(null);
              setLocations([]);
              setNotice(null);
              setLoading(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void search();
              }
            }}
          />
        </label>
        <Button
          type="button"
          disabled={disabled || loading || query.trim().length < 2}
          onClick={() => void search()}
          xstyle={styles.searchButton}
        >
          {loading ? "Searching…" : "Search cities"}
        </Button>
        <label {...stylex.props(styles.field)}>
          Temperature
          <select
            aria-label="Weather temperature unit"
            value={unit}
            disabled={disabled}
            onChange={(event) =>
              onUnitChange(event.target.value as "celsius" | "fahrenheit")
            }
            {...stylex.props(styles.input)}
          >
            <option value="celsius">Celsius · °C</option>
            <option value="fahrenheit">Fahrenheit · °F</option>
          </select>
        </label>
      </div>
      {!!locations.length && (
        <fieldset
          aria-label="Matching cities"
          {...stylex.props(styles.results)}
        >
          {locations.map((location) => (
            <Button
              key={location.id}
              type="button"
              disabled={disabled}
              aria-pressed={selected?.id === location.id}
              onClick={() => onSelect(location)}
              xstyle={[
                styles.result,
                selected?.id === location.id && styles.resultSelected,
              ]}
            >
              {[location.name, location.region, location.country]
                .filter(Boolean)
                .join(", ")}
            </Button>
          ))}
        </fieldset>
      )}
      {selected && !locations.length && (
        <p {...stylex.props(styles.error)}>
          Selected:{" "}
          {[selected.name, selected.region, selected.country]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}
      {notice && (
        <p role="status" {...stylex.props(styles.error)}>
          {notice}
        </p>
      )}
    </div>
  );
}

const styles = stylex.create({
  container: { marginBottom: 16 },
  form: {
    display: "flex",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12,
    marginBottom: 20,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    color: colors.muted,
  },
  name: { flex: "1 1 170px", minWidth: 0, maxWidth: 320 },
  input: {
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    color: colors.foreground,
    paddingInline: 10,
    font: "inherit",
    fontSize: 16,
    outlineOffset: 3,
  },
  create: {
    minHeight: 44,
    paddingInline: 14,
    color: colors.onAccent,
    backgroundColor: colors.accent,
  },
  weather: { flexBasis: "100%", minWidth: 0 },
  search: {
    display: "flex",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 10,
  },
  city: { flex: "1 1 160px", minWidth: 0, maxWidth: 320 },
  searchButton: { minHeight: 44 },
  results: {
    borderWidth: 0,
    padding: 0,
    margin: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
    marginTop: 10,
    maxWidth: 560,
  },
  result: {
    minHeight: 44,
    justifyContent: "flex-start",
    textAlign: "left",
    whiteSpace: "normal",
    paddingInline: 10,
  },
  resultSelected: {
    backgroundColor: colors.selected,
    color: colors.foreground,
  },
  error: { fontSize: 12, lineHeight: 1.6, color: colors.muted },
});
