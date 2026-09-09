import type { DatabaseSync } from "node:sqlite";
import { validateOrigin } from "./store.server";

/** Read-only startup verification. SQLite integrity alone cannot detect malformed
 * auth JSON or missing tables that would leave the owner unable to sign in. */
export function verifyAuthReadiness(db: DatabaseSync) {
  const config = JSON.parse(
    String(db.prepare("SELECT value FROM config WHERE id=1").get()?.value),
  );
  validateOrigin(config.origin);
  if (
    typeof config.owner !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(config.owner) ||
    !Number.isSafeInteger(config.generation) ||
    config.generation < 1 ||
    !Number.isFinite(config.expires) ||
    config.expires < 0 ||
    (config.bootstrap !== null &&
      (typeof config.bootstrap !== "string" ||
        !/^[a-f0-9]{64}$/.test(config.bootstrap)))
  )
    throw new Error("Auth configuration failed readiness checks.");
  const credentials = db.prepare("SELECT id,value FROM credentials").all();
  if (
    !credentials.length &&
    (!config.bootstrap || config.expires <= Date.now())
  )
    throw new Error("Auth has no owner credential or enrollment path.");
  for (const row of credentials) {
    const credential = JSON.parse(String(row.value));
    if (
      credential.id !== row.id ||
      typeof credential.id !== "string" ||
      !credential.id ||
      typeof credential.publicKey !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(credential.publicKey) ||
      !Number.isSafeInteger(credential.counter) ||
      credential.counter < 0
    )
      throw new Error("Auth credential failed readiness checks.");
  }
  db.prepare(
    "SELECT id,credential,created,expires FROM sessions LIMIT 0",
  ).all();
  db.prepare("SELECT id,value,expires FROM ceremonies LIMIT 0").all();
  db.prepare("SELECT id,count,expires FROM limits LIMIT 0").all();
}
