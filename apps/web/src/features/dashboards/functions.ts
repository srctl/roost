import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import {
  getDashboardPreference,
  listDashboards,
  listDatasets,
  setDashboardPreference,
} from "../../server/dashboards/store.server";

const result = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: () => ({
          ok: false as const,
          error: "Could not access dashboards. Check Roost and try again.",
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
  .handler(({ data }) =>
    result(
      Effect.gen(function* () {
        const preference = yield* getDashboardPreference();
        return {
          ...preference,
          datasets: preference.enabled ? yield* listDatasets(data.agentId) : [],
          widgets: preference.enabled
            ? yield* listDashboards(data.agentId)
            : [],
        };
      }),
    ),
  );
