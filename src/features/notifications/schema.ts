import { Schema } from "effect";

export const NotificationPreferences = Schema.Struct({
  enabled: Schema.Boolean,
  turnCompleted: Schema.Boolean,
  agentUpdates: Schema.Boolean,
  needsAttention: Schema.Boolean,
});

export type NotificationPreferences = typeof NotificationPreferences.Type;

export const NotificationPreferencesPatch = Schema.partial(
  NotificationPreferences,
);

export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  turnCompleted: true,
  agentUpdates: true,
  needsAttention: true,
};
