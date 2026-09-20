import { Effect } from "effect";
import { withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";
import { type APNsOptions, readAPNsConfig } from "../notifications/apns.server";
import { MobileTokens } from "./tokens.server";

// The central mobile handler authenticates the bearer and rejects browser
// origins before invoking this endpoint. Never accept a device identity in JSON.
export async function mobileNotificationsRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
  deviceId: string,
  options: Pick<APNsOptions, "directory" | "env"> = {},
): Promise<{ value: unknown; status?: number } | null> {
  if (path !== "notifications/push") return null;
  if (!["GET", "POST", "DELETE"].includes(request.method))
    return { value: { error: "Method not allowed." }, status: 405 };
  await Effect.runPromise(withAgentStore(assertAvailable, options.directory));
  const store = new MobileTokens(options.directory);
  try {
    if (!store.active(deviceId))
      return {
        value: { error: "Reconnect with a valid device token." },
        status: 401,
      };
    const config = readAPNsConfig(options.env);
    if (request.method === "POST") {
      if (!config)
        return {
          value: {
            error:
              "Native push notifications are not configured on this server.",
          },
          status: 409,
        };
      const input = await body(request);
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some(
          (key) => !["deviceToken", "bundleId", "environment"].includes(key),
        )
      )
        return {
          value: { error: "Invalid notification registration." },
          status: 400,
        };
      const { deviceToken, bundleId, environment } = input as Record<
        string,
        unknown
      >;
      if (
        typeof deviceToken !== "string" ||
        !/^(?:[a-f0-9]{2}){1,256}$/i.test(deviceToken) ||
        typeof bundleId !== "string" ||
        (environment !== "sandbox" && environment !== "production")
      )
        return {
          value: { error: "Invalid notification registration." },
          status: 400,
        };
      if (bundleId !== config.bundleId || environment !== config.environment)
        return {
          value: {
            error:
              "This app’s push environment or bundle ID does not match the server configuration.",
          },
          status: 409,
        };
      try {
        store.registerPush(deviceId, {
          token: deviceToken.toLowerCase(),
          topic: bundleId,
          environment,
        });
      } catch {
        return {
          value: {
            error:
              "Could not register this device for notifications. Remove an old device or reconnect and retry.",
          },
          status: 409,
        };
      }
    } else if (request.method === "DELETE")
      store.removePushRegistration(deviceId);
    const registration = store.pushRegistration(deviceId);
    const registered = Boolean(
      registration &&
        config &&
        registration.topic === config.bundleId &&
        registration.environment === config.environment,
    );
    return {
      value: {
        configured: config !== null,
        registered,
        environment: config?.environment ?? null,
        bundleId: config?.bundleId ?? null,
        registrationId: registered ? registration!.registrationId : null,
      },
    };
  } finally {
    store.close();
  }
}
