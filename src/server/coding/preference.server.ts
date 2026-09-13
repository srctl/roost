import type { DatabaseSync } from "node:sqlite";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { assertAvailable } from "../maintenance.server";

export function codingEnabled(db: DatabaseSync) {
  return (
    db.prepare("SELECT enabled FROM coding_feature_settings WHERE id=1").get()
      ?.enabled === 1
  );
}

export function requireCodingEnabled(db: DatabaseSync) {
  if (!codingEnabled(db))
    throw new AgentStoreError({
      message:
        "Coding is off. Enable it in Settings to start or continue work.",
    });
}

export const getCodingPreference = () =>
  withAgentStore((db) => ({ enabled: codingEnabled(db) }));
export const setCodingPreference = (enabled: boolean) =>
  withAgentStore((db) => {
    assertAvailable(db);
    db.prepare("UPDATE coding_feature_settings SET enabled=? WHERE id=1").run(
      Number(enabled),
    );
    return { enabled };
  });
