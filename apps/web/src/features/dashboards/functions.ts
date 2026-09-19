import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import {
  readDashboard,
  updateDashboardPresentation,
} from "../../server/dashboards/presentation.server";
import {
  getDashboardPreference,
  setDashboardPreference,
} from "../../server/dashboards/store.server";
import { changeDashboardPresentationSchema } from "./presentation";

const result = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({
          ok: false as const,
          error:
            error && typeof error === "object" && "message" in error
              ? String(error.message).replace(/^PRESENTATION_CONFLICT:\s*/, "")
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
