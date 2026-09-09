import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { verifyAuthReadiness } from "../src/server/auth/readiness.server";
import { AuthStore } from "../src/server/auth/store.server";

test("candidate auth checks reject malformed JSON, lost credentials and missing API tables without writing", () => {
  const root = mkdtempSync("/tmp/roost-auth-readiness-");
  const store = new AuthStore(root);
  store.setup("http://localhost:4195");
  store.close();
  const db = new DatabaseSync(join(root, "auth.sqlite"));
  try {
    verifyAuthReadiness(db);
    const original = db
      .prepare("SELECT value FROM config WHERE id=1")
      .get()!.value;
    for (const bad of [
      "{",
      JSON.stringify({
        ...JSON.parse(String(original)),
        origin: "http://untrusted.test",
      }),
      JSON.stringify({ ...JSON.parse(String(original)), bootstrap: null }),
      JSON.stringify({ ...JSON.parse(String(original)), expires: 1 }),
    ]) {
      db.prepare("UPDATE config SET value=?").run(bad);
      assert.throws(() => verifyAuthReadiness(db));
    }
    db.prepare("UPDATE config SET value=?").run(original);
    db.prepare("INSERT INTO credentials VALUES (?,?)").run("bad", "{}");
    assert.throws(() => verifyAuthReadiness(db));
    db.exec("DELETE FROM credentials; DROP TABLE sessions");
    assert.throws(() => verifyAuthReadiness(db));
    db.exec(
      "CREATE TABLE sessions(id TEXT,credential TEXT,created INTEGER,expires INTEGER)",
    );
    const readonly = new DatabaseSync(join(root, "auth.sqlite"), {
      readOnly: true,
    });
    try {
      verifyAuthReadiness(readonly);
    } finally {
      readonly.close();
    }
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
