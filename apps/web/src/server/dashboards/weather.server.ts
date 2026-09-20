import { Effect } from "effect";
import type { DashboardWeather } from "../../features/dashboards/schema";
import {
  type DashboardWeatherInput,
  decodeDashboardWeatherInput,
  decodeWeatherSearch,
} from "../../features/dashboards/weather";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { listDashboards } from "./store.server";
import { WeatherUnavailable, weatherProvider } from "./weather-provider.server";

const unavailable = (error: unknown) =>
  new AgentStoreError({
    message:
      error instanceof WeatherUnavailable
        ? error.message
        : "Weather is temporarily unavailable. Try again shortly.",
  });
const access = (agentId: string) =>
  withAgentStore((db) => {
    assertAvailable(db);
    requireAgent(db, agentId);
    if (
      db.prepare("SELECT enabled FROM dashboard_settings WHERE id=1").get()
        ?.enabled !== 1
    )
      throw new AgentStoreError({
        message: "Dashboards are off. Enable them in Settings first.",
      });
  });

export const searchWeatherLocations = (agentId: string, input: unknown) =>
  Effect.gen(function* () {
    const data = yield* Effect.try({
      try: () => decodeWeatherSearch(input),
      catch: () =>
        new AgentStoreError({
          message: "Search for a city using 2 to 100 characters.",
        }),
    });
    yield* access(agentId);
    const locations = yield* Effect.tryPromise({
      try: () => weatherProvider.search(data.query),
      catch: unavailable,
    });
    yield* access(agentId);
    return locations;
  });

function readBlock(agentId: string, input: DashboardWeatherInput) {
  return Effect.gen(function* () {
    const widgets = yield* listDashboards(agentId);
    const widget = widgets.find((item) => item.key === input.key);
    const block = widget?.blocks.find(
      (item) => item.type === "weather" && item.id === input.blockId,
    ) as DashboardWeather | undefined;
    if (!block)
      return yield* Effect.fail(
        new AgentStoreError({
          message: "This weather tracker is no longer available.",
        }),
      );
    return block;
  });
}

export const getDashboardWeather = (agentId: string, input: unknown) =>
  Effect.gen(function* () {
    const data = yield* Effect.try({
      try: () => decodeDashboardWeatherInput(input),
      catch: () =>
        new AgentStoreError({
          message: "Provide a saved weather tracker and block.",
        }),
    });
    const block = yield* readBlock(agentId, data);
    const report = yield* Effect.tryPromise({
      try: () =>
        weatherProvider.forecast(block.locationId, block.unit, data.refresh),
      catch: unavailable,
    });
    // Do not return a report for a location/unit removed or changed while fetching.
    const latest = yield* readBlock(agentId, data);
    if (latest.locationId !== block.locationId || latest.unit !== block.unit)
      return yield* Effect.fail(
        new AgentStoreError({
          message:
            "DASHBOARD_CONFLICT: This weather tracker changed. Refresh it and try again.",
        }),
      );
    return report;
  });
