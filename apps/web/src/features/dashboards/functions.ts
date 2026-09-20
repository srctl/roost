import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import {
  createDashboardTracker as createDashboardTrackerRecord,
  updateDashboardContent,
} from "../../server/dashboards/actions.server";
import { readChatDashboard } from "../../server/dashboards/chat.server";
import {
  readDashboard,
  updateDashboardPresentation,
} from "../../server/dashboards/presentation.server";
import {
  getDashboardPreference,
  setDashboardPreference,
} from "../../server/dashboards/store.server";
import {
  searchWeatherLocations as findWeatherLocations,
  getDashboardWeather as readWeather,
} from "../../server/dashboards/weather.server";
import { decodeCreateDashboardTracker, decodeDashboardAction } from "./actions";
import { decodeChatDashboardInput } from "./chat";
import { changeDashboardPresentationSchema } from "./presentation";
import { decodeDashboardWeatherInput, decodeWeatherSearch } from "./weather";

const result = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({
          ok: false as const,
          error:
            error && typeof error === "object" && "message" in error
              ? String(error.message).replace(
                  /^(?:PRESENTATION|DASHBOARD)_CONFLICT:\s*/,
                  "",
                )
              : "Could not access dashboards. Check Roost and try again.",
        }),
      }),
    ),
  );

export const getDashboardSetting = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(() => result(getDashboardPreference()));
export const changeDashboardSetting = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean })),
  )
  .handler(({ data }) => result(setDashboardPreference(data.enabled)));
export const getDashboard = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.Struct({ agentId: Schema.UUID })))
  .handler(({ data }) => result(readDashboard(data.agentId)));

export const getChatDashboard = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(decodeChatDashboardInput)
  .handler(({ data }) => result(readChatDashboard(data.agentId, data.key)));

export const searchWeatherLocations = createServerFn({ method: "GET" })
  .middleware([available])
  .validator((input: unknown) => {
    const { agentId, ...search } = input as Record<string, unknown>;
    return {
      agentId: Schema.decodeUnknownSync(Schema.UUID)(agentId),
      ...decodeWeatherSearch(search),
    };
  })
  .handler(({ data: { agentId, ...data } }) =>
    result(findWeatherLocations(agentId, data)),
  );

export const getDashboardWeather = createServerFn({ method: "GET" })
  .middleware([available])
  .validator((input: unknown) => {
    const { agentId, ...weather } = input as Record<string, unknown>;
    return {
      agentId: Schema.decodeUnknownSync(Schema.UUID)(agentId),
      ...decodeDashboardWeatherInput(weather),
    };
  })
  .handler(({ data: { agentId, ...data } }) =>
    result(readWeather(agentId, data)),
  );

export const changeDashboardPresentation = createServerFn({ method: "POST" })
  .middleware([available])
  .validator((input: unknown) => {
    const { agentId, ...change } = input as Record<string, unknown>;
    return {
      agentId: Schema.decodeUnknownSync(Schema.UUID)(agentId),
      ...changeDashboardPresentationSchema.parse(change),
    };
  })
  .handler(({ data: { agentId, ...data } }) =>
    result(updateDashboardPresentation(agentId, data)),
  );

export const changeDashboardContent = createServerFn({ method: "POST" })
  .middleware([available])
  .validator((input: unknown) => {
    const { agentId, ...action } = input as Record<string, unknown>;
    return {
      agentId: Schema.decodeUnknownSync(Schema.UUID)(agentId),
      ...decodeDashboardAction(action),
    };
  })
  .handler(({ data: { agentId, ...data } }) =>
    result(updateDashboardContent(agentId, data)),
  );

export const createDashboardTracker = createServerFn({ method: "POST" })
  .middleware([available])
  .validator((input: unknown) => {
    const { agentId, ...tracker } = input as Record<string, unknown>;
    return {
      agentId: Schema.decodeUnknownSync(Schema.UUID)(agentId),
      ...decodeCreateDashboardTracker(tracker),
    };
  })
  .handler(({ data: { agentId, ...data } }) =>
    result(createDashboardTrackerRecord(agentId, data)),
  );
