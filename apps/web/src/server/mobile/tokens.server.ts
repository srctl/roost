import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT UNIQUE NOT NULL,
        created INTEGER NOT NULL, expires INTEGER NOT NULL
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
