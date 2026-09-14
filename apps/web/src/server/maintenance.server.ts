import type { DatabaseSync } from "node:sqlite";
import { AgentStoreError } from "./agents/store.server";

export const isMaintenance = (db: DatabaseSync) =>
  db.prepare("SELECT maintenance FROM runtime_control WHERE id=1").get()
    ?.maintenance === 1;

export function assertAvailable(db: DatabaseSync) {
  if (isMaintenance(db))
    throw new AgentStoreError({
      message: "Roost is updating. Please try again shortly.",
    });
}
