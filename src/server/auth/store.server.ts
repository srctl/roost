import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { WebAuthnCredential } from "@simplewebauthn/server";

export const token = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const dataDirectory = () =>
  resolve(process.env.ROOST_DATA_DIR ?? ".roost");
export const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
export type AuthConfig = {
  origin: string;
  owner: string;
  bootstrap: string | null;
  expires: number;
  generation: number;
};
export type Session = {
  id: string;
  credential: string;
  created: number;
  expires: number;
};
export type Credential = {
  id: string;
  name: string;
  publicKey: string;
  counter: number;
  transports?: WebAuthnCredential["transports"];
  created: number;
};
export type Ceremony = {
  challenge: string;
  kind: "setup" | "add" | "login";
  session: string | null;
  bootstrap: string | null;
  generation: number;
};

export function validateOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost"))
  )
    throw new Error(
      "Use an HTTPS origin (or http://localhost for development) with no path or trailing slash, e.g. https://roost.example.com.",
    );
  return url.origin;
}

export class AuthStore {
  private db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "auth.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, credential TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ceremonies (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  }
  close() {
    this.db.close();
  }
  transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  config(): AuthConfig {
    const value = this.db
      .prepare("SELECT value FROM config WHERE id=1")
      .get()?.value;
    if (!value)
      throw new Error(
        "Auth is not configured. Run roost auth setup --origin https://your-host.",
      );
    return JSON.parse(String(value));
  }
  private saveConfig(value: AuthConfig) {
    this.db
      .prepare("INSERT OR REPLACE INTO config VALUES (1, ?)")
      .run(JSON.stringify(value));
  }
  setup(origin: string | undefined, recover = false) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT value FROM config WHERE id=1").get();
      const old: AuthConfig | undefined = row
        ? JSON.parse(String(row.value))
        : undefined;
      if (old && !recover && this.credentials().length)
        throw new Error(
          "An owner is already registered. Use roost auth recover if you lost access.",
        );
      if (!old && recover) throw new Error("Run roost auth setup first.");
      const nextOrigin = validateOrigin(origin ?? old?.origin ?? "");
      if (old && nextOrigin !== old.origin && !recover)
        throw new Error(
          "Changing the origin requires roost auth recover and registering a new passkey.",
        );
      const secret = token();
      this.saveConfig({
        origin: nextOrigin,
        owner: old?.owner ?? token(),
        bootstrap: digest(secret),
        expires: Date.now() + 15 * 60_000,
        generation: (old?.generation ?? 0) + 1,
      });
      this.db.exec(
        "DELETE FROM sessions; DELETE FROM ceremonies; DELETE FROM limits;",
      );
      if (recover) this.db.exec("DELETE FROM credentials;");
      return `${nextOrigin}/auth#setup=${secret}`;
    });
  }
  credentials(): Credential[] {
    return this.db
      .prepare("SELECT value FROM credentials ORDER BY rowid")
      .all()
      .map((row) => JSON.parse(String(row.value)));
  }
  saveCredential(credential: Credential) {
    this.db
      .prepare("INSERT OR REPLACE INTO credentials VALUES (?, ?)")
      .run(credential.id, JSON.stringify(credential));
  }
  finishSetup(bootstrap: string | null) {
    const config = this.config();
    if (
      !bootstrap ||
      config.bootstrap !== bootstrap ||
      config.expires < Date.now() ||
      this.credentials().length
    )
      throw new Error(
        "Setup link expired or was already used. Generate another link on the server.",
      );
    this.saveConfig({ ...config, bootstrap: null, expires: 0 });
  }
  session(id: string | null): Session | undefined {
    if (!id) return;
    return this.db
      .prepare("SELECT * FROM sessions WHERE id=? AND expires>?")
      .get(id, Date.now()) as Session | undefined;
  }
  sessions(): Session[] {
    return this.db
      .prepare("SELECT * FROM sessions WHERE expires>? ORDER BY created DESC")
      .all(Date.now()) as Session[];
  }
  createSession(credential: string) {
    const secret = token();
    this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)")
      .run(
        digest(secret),
        credential,
        Date.now(),
        Date.now() + sessionLifetime,
      );
    this.db.exec(
      "DELETE FROM sessions WHERE id IN (SELECT id FROM sessions ORDER BY created DESC LIMIT -1 OFFSET 30)",
    );
    return secret;
  }
  revokeSession(id: string) {
    this.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
  }
  removeCredential(id: string) {
    this.transaction(() => {
      if (this.credentials().length <= 1)
        throw new Error("Add another passkey before removing your last one.");
      this.db.prepare("DELETE FROM credentials WHERE id=?").run(id);
      this.db.prepare("DELETE FROM sessions WHERE credential=?").run(id);
    });
  }
  ceremony(value: Ceremony) {
    this.db.prepare("DELETE FROM ceremonies WHERE expires<=?").run(Date.now());
    const secret = token();
    this.db
      .prepare("INSERT INTO ceremonies VALUES (?, ?, ?)")
      .run(digest(secret), JSON.stringify(value), Date.now() + 5 * 60_000);
    return secret;
  }
  consumeCeremony(secret: string | null): Ceremony {
    const row = this.db
      .prepare(
        "DELETE FROM ceremonies WHERE id=? AND expires>? RETURNING value",
      )
      .get(digest(secret ?? ""), Date.now());
    if (!row) throw new Error("This request expired. Try again.");
    return JSON.parse(String(row.value));
  }
  limit(id: string, maximum: number) {
    const row = this.db
      .prepare(`INSERT INTO limits VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET
      count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,
      expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count`)
      .get(id, Date.now() + 60_000, Date.now(), Date.now());
    return Number(row?.count) <= maximum;
  }
}

// Absence is the existing private-proxy mode. An existing but damaged/unconfigured
// database fails closed; it never silently disables authentication.
export const nativeAuthEnabled = (directory = dataDirectory()) =>
  existsSync(join(directory, "auth.sqlite"));

export function openAuth(directory = dataDirectory()) {
  if (!nativeAuthEnabled(directory)) return null;
  return new AuthStore(directory);
}
