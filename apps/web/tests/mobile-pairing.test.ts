import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { mobileCommand } from "../src/cli/mobile";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

test("SSH pairing credentials authenticate the real mobile API; renewal preserves identity and cannot recreate a revoked device", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "roost-pairing-"));
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = root;
  let output = "";
  t.mock.method(console, "log", (value: string) => {
    output = value;
  });
  const id = randomUUID();
  const handler = createMobileHandler();
  const request = async (secret: string) =>
    (
      await handler(
        new Request("https://fixture.example/api/mobile/v1/session", {
          headers: { Authorization: `Bearer ${secret}` },
        }),
      )
    )?.status;
  try {
    mobileCommand(
      ["create", "--name", "Roost-Mac", "--id", id, "--json"],
      root,
    );
    const record = z.object({
      id: z.uuid(),
      token: z.string(),
      expires: z.number(),
    });
    const first = record.parse(JSON.parse(output));
    assert.equal(first.id, id);
    assert.equal(await request(first.token), 200);
    mobileCommand(["renew", "--id", id, "--json"], root);
    const renewed = record.parse(JSON.parse(output));
    assert.equal(renewed.id, id);
    assert.equal(await request(first.token), 401);
    assert.equal(await request(renewed.token), 200);
    const store = new MobileTokens(root);
    try {
      store.revoke(id);
    } finally {
      store.close();
    }
    assert.equal(await request(renewed.token), 401);
    assert.throws(
      () => mobileCommand(["renew", "--id", id, "--json"], root),
      /revoked/,
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
