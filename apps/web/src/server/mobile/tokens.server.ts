import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeTransaction } from "../transaction.server";

export type MobilePushRegistration = {
  deviceId: string;
  registrationId: string;
  token: string;
  topic: string;
  environment: "sandbox" | "production";
  updatedAt: number;
};

const directory = () => resolve(process.env.ROOST_DATA_DIR ?? ".roost");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class MobileTokens {
  private db: DatabaseSync;
  constructor(root = directory()) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const path = join(root, "mobile.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL,
        created INTEGER NOT NULL, expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mobile_push_registrations (
        deviceId TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        registrationId TEXT UNIQUE NOT NULL, token TEXT NOT NULL,
        topic TEXT NOT NULL, environment TEXT NOT NULL,
        updatedAt INTEGER NOT NULL,
        UNIQUE(token,topic,environment)
      );`);
  }
  close() {
    this.db.close();
  }
  create(name: string) {
    if (!name.trim() || name.length > 80)
      throw new Error("Choose a device name of 1–80 characters.");
    const id = randomUUID();
    const secret = `roost_mobile_${randomBytes(32).toString("base64url")}`;
    const expires = Date.now() + 90 * 24 * 60 * 60 * 1000;
    this.db
      .prepare("INSERT INTO devices VALUES (?,?,?,?,?)")
      .run(id, name.trim(), hash(secret), Date.now(), expires);
    return { id, secret, expires };
  }
  list() {
    return this.db
      .prepare(
        "SELECT id,name,created,expires FROM devices ORDER BY created DESC",
      )
      .all();
  }
  revoke(id: string) {
    return (
      this.db.prepare("DELETE FROM devices WHERE id=?").run(id).changes > 0
    );
  }
  authenticate(secret: string) {
    if (!/^roost_mobile_[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    const row = this.db
      .prepare("SELECT id FROM devices WHERE hash=? AND expires>?")
      .get(hash(secret), Date.now());
    return row ? String(row.id) : null;
  }
  active(id: string) {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM devices WHERE id=? AND expires>?")
        .get(id, Date.now()),
    );
  }

  pushRegistration(deviceId: string): MobilePushRegistration | null {
    return (
      (this.db
        .prepare(
          "SELECT p.* FROM mobile_push_registrations p JOIN devices d ON p.deviceId=d.id WHERE p.deviceId=? AND d.expires>?",
        )
        .get(deviceId, Date.now()) as MobilePushRegistration | undefined) ??
      null
    );
  }

  registerPush(
    deviceId: string,
    input: Pick<MobilePushRegistration, "token" | "topic" | "environment">,
  ) {
    return writeTransaction(this.db, () => {
      if (!this.active(deviceId))
        throw new Error("Reconnect with a valid device token.");
      this.db
        .prepare(
          "DELETE FROM mobile_push_registrations WHERE deviceId IN (SELECT id FROM devices WHERE expires<=?)",
        )
        .run(Date.now());
      const current = this.pushRegistration(deviceId);
      // Reconnecting the same app to a newly issued mobile credential transfers
      // the APNs token. The previous credential cannot delete the new binding.
      this.db
        .prepare(
          "DELETE FROM mobile_push_registrations WHERE token=? AND topic=? AND environment=? AND deviceId<>?",
        )
        .run(input.token, input.topic, input.environment, deviceId);
      if (
        !current &&
        Number(
          this.db
            .prepare("SELECT count(*) AS count FROM mobile_push_registrations")
            .get()?.count,
        ) >= 32
      )
        throw new Error("Too many devices have notifications enabled.");
      const unchanged =
        current?.token === input.token &&
        current.topic === input.topic &&
        current.environment === input.environment;
      const registrationId = unchanged ? current.registrationId : randomUUID();
      const updatedAt = Math.max(Date.now(), (current?.updatedAt ?? 0) + 1);
      this.db
        .prepare(
          "INSERT INTO mobile_push_registrations(deviceId,registrationId,token,topic,environment,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(deviceId) DO UPDATE SET registrationId=excluded.registrationId,token=excluded.token,topic=excluded.topic,environment=excluded.environment,updatedAt=excluded.updatedAt",
        )
        .run(
          deviceId,
          registrationId,
          input.token,
          input.topic,
          input.environment,
          updatedAt,
        );
      return this.pushRegistration(deviceId)!;
    });
  }

  removePushRegistration(deviceId: string) {
    this.db
      .prepare("DELETE FROM mobile_push_registrations WHERE deviceId=?")
      .run(deviceId);
  }

  pushTargets() {
    return this.db
      .prepare(
        "SELECT p.* FROM mobile_push_registrations p JOIN devices d ON p.deviceId=d.id WHERE d.expires>? LIMIT 32",
      )
      .all(Date.now()) as MobilePushRegistration[];
  }

  expirePushRegistration(
    registration: MobilePushRegistration,
    timestamp?: number,
  ) {
    if (timestamp !== undefined && timestamp < registration.updatedAt) return;
    this.db
      .prepare(
        "DELETE FROM mobile_push_registrations WHERE registrationId=? AND updatedAt=?",
      )
      .run(registration.registrationId, registration.updatedAt);
  }
}

export function mobileDeviceActive(id: string) {
  if (!existsSync(join(directory(), "mobile.sqlite"))) return false;
  const store = new MobileTokens();
  try {
    return store.active(id);
  } finally {
    store.close();
  }
}

export function mobileIdentity(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (
    !authorization.startsWith("Bearer ") ||
    !existsSync(join(directory(), "mobile.sqlite"))
  )
    return null;
  const store = new MobileTokens();
  try {
    return store.authenticate(authorization.slice(7));
  } finally {
    store.close();
  }
}
