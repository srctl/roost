import { Effect, Schema } from "effect";
import { withAgentStore } from "../agents/store.server";
import {
  getDashboardPreference,
  setDashboardPreference,
} from "../dashboards/store.server";
import { assertAvailable } from "../maintenance.server";

// Display style/activity expansion are device-local, matching web preferences.
// Dashboard enablement is shared and uses exactly the same store as web/PWA.
export async function mobileDisplaySettingsRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
): Promise<{ value: unknown; status?: number } | null> {
  if (path !== "settings/dashboards") return null;
  await Effect.runPromise(withAgentStore(assertAvailable));
  if (request.method === "GET")
    return { value: await Effect.runPromise(getDashboardPreference()) };
  if (request.method === "POST") {
    const input = Schema.decodeUnknownSync(
      Schema.Struct({ enabled: Schema.Boolean }),
    )(await body(request));
    return {
      value: await Effect.runPromise(setDashboardPreference(input.enabled)),
    };
  }
  return { value: { error: "Method not allowed." }, status: 405 };
}
