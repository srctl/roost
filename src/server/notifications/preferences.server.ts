import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import {
  NotificationPreferences,
  NotificationPreferencesPatch,
} from "../../features/notifications/schema";
import { withAgentStore } from "../agents/store.server";
import { writeTransaction } from "../transaction.server";

export function readNotificationPreferences(db: DatabaseSync) {
  const row = db
    .prepare("SELECT preferences FROM notification_settings WHERE id=1")
    .get()!;
  return Schema.decodeUnknownSync(NotificationPreferences)(
    JSON.parse(String(row.preferences)),
  );
}

export const getNotificationPreferences = (directory?: string) =>
  withAgentStore(readNotificationPreferences, directory);

export const setNotificationPreferences = (
  patch: Partial<NotificationPreferences>,
  directory?: string,
) =>
  withAgentStore(
    (db) =>
      writeTransaction(db, () => {
        const preferences = Schema.decodeUnknownSync(NotificationPreferences)({
          ...readNotificationPreferences(db),
          ...Schema.decodeUnknownSync(NotificationPreferencesPatch)(patch),
        });
        db.prepare(
          "UPDATE notification_settings SET preferences=? WHERE id=1",
        ).run(JSON.stringify(preferences));
        return preferences;
      }),
    directory,
  );
