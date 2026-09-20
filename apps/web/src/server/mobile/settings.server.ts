import { Effect, Schema } from "effect";
import { NotificationPreferencesPatch } from "../../features/notifications/schema";
import { withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import {
  getNotificationPreferences,
  setNotificationPreferences,
} from "../notifications/preferences.server";

export async function mobileSettingsRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
): Promise<{ value: unknown; status?: number } | null> {
  if (path !== "settings/notifications") return null;
  await Effect.runPromise(withAgentStore(assertAvailable));
  if (request.method === "GET")
    return { value: await Effect.runPromise(getNotificationPreferences()) };
  if (request.method === "POST") {
    const patch = Schema.decodeUnknownSync(NotificationPreferencesPatch)(
      await body(request),
    );
    return {
      value: await Effect.runPromise(setNotificationPreferences(patch)),
    };
  }
  return { value: { error: "Method not allowed." }, status: 405 };
}
