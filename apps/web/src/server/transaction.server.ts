import type { DatabaseSync } from "node:sqlite";

// Acquire the write lock before reading state used to decide updates.
export function writeTransaction<A>(db: DatabaseSync, run: () => A): A {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = run();
    db.exec("COMMIT");

    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
