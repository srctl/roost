import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import { setNotificationPreferences } from "../../server/notifications/preferences.server";
import {
  readPushSettings,
  removePushSubscription,
  savePushSubscription,
} from "../../server/notifications/push.server";
import { NotificationPreferencesPatch } from "./schema";

const Endpoint = Schema.String.pipe(Schema.maxLength(4096));
const result = <A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );

// POST keeps the device's endpoint out of URL/query access logs.
export const getPushSettings = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({ endpoint: Schema.optional(Endpoint) }),
    ),
  )
  .handler(({ data }) => result(readPushSettings(data.endpoint)));

export const enablePush = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(
    Schema.decodeUnknownSync(
      Schema.Struct({
        publicKey: Schema.String.pipe(Schema.maxLength(100)),
        endpoint: Endpoint,
        keys: Schema.Struct({
          p256dh: Schema.String.pipe(Schema.maxLength(100)),
          auth: Schema.String.pipe(Schema.maxLength(30)),
        }),
      }),
    ),
  )
  .handler(({ data }) => result(savePushSubscription(data, data.publicKey)));

export const disablePush = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(Schema.Struct({ endpoint: Endpoint })))
  .handler(({ data }) => result(removePushSubscription(data.endpoint)));

export const changeNotificationPreferences = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(NotificationPreferencesPatch))
  .handler(({ data }) => result(setNotificationPreferences(data)));
