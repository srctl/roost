import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import type { CodexLogin } from "../src/features/auth/schema";
import { createMobileAccountRequest } from "../src/server/mobile/account.server";
import { createMobileHandler } from "../src/server/mobile/http.server";
import { MobileTokens } from "../src/server/mobile/tokens.server";

test("native Codex connection shares bounded start, poll and matching cancellation without exposing credentials", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-account-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  let login: CodexLogin = { status: "idle" };
  let starts = 0;
  const handle = createMobileAccountRequest({
    getAccount: async () => ({ configured: true }),
    getLogin: () => login,
    startLogin: async () => {
      starts++;
      login = {
        status: "pending",
        loginId: "login-1",
        verificationUrl: "https://auth.openai.com/codex/device",
        userCode: "TEST-CODE",
      };
      return login;
    },
    cancelLogin: async (id) => {
      if (login.status === "pending" && login.loginId === id)
        login = { status: "idle" };
      return login;
    },
  });
  const request = (path: string, method = "GET", input?: unknown) =>
    handle(
      path,
      new Request(`https://roost.example/api/mobile/v1/${path}`, { method }),
      async () => input,
    );
  try {
    assert.deepEqual((await request("account"))?.value, {
      configured: true,
      login: { status: "idle" },
    });
    assert.equal(starts, 0, "reading account state never starts sign-in");
    assert.deepEqual((await request("account/login", "POST"))?.value, {
      status: "pending",
      loginId: "login-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "TEST-CODE",
    });
    assert.deepEqual((await request("account/login"))?.value, login);
    assert.deepEqual(
      (await request("account/login", "DELETE", { loginId: "wrong" }))?.value,
      login,
    );
    assert.deepEqual(
      (await request("account/login", "DELETE", { loginId: "login-1" }))?.value,
      { status: "idle" },
    );
    await assert.rejects(request("account/login", "DELETE", { loginId: "" }));
    assert.equal((await request("account", "POST"))?.status, 405);
    assert.equal(
      await request("auth/api/sessions"),
      null,
      "native token does not dispatch browser session operations",
    );
  } finally {
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Codex account mobile operations require a device token and reject browser-origin traffic", async () => {
  const directory = mkdtempSync("/tmp/roost-mobile-account-auth-");
  const previous = process.env.ROOST_DATA_DIR;
  process.env.ROOST_DATA_DIR = directory;
  const tokens = new MobileTokens(directory);
  const device = tokens.create("Account test");
  const handler = createMobileHandler(async () => {});
  try {
    for (const [path, method] of [
      ["account", "GET"],
      ["account/login", "GET"],
      ["account/login", "POST"],
      ["account/login", "DELETE"],
    ]) {
      assert.equal(
        (
          await handler(
            new Request(`https://roost.example/api/mobile/v1/${path}`, {
              method,
            }),
          )
        )?.status,
        401,
      );
      assert.equal(
        (
          await handler(
            new Request(`https://roost.example/api/mobile/v1/${path}`, {
              method,
              headers: {
                Authorization: `Bearer ${device.secret}`,
                Origin: "https://roost.example",
              },
            }),
          )
        )?.status,
        403,
      );
    }
    const allowed = await handler(
      new Request("https://roost.example/api/mobile/v1/account", {
        method: "POST",
        headers: { Authorization: `Bearer ${device.secret}` },
      }),
    );
    assert.equal(
      allowed?.status,
      405,
      "authenticated requests reach the account dispatcher",
    );
    assert.match(allowed?.headers.get("cache-control") ?? "", /no-store/);
  } finally {
    tokens.close();
    if (previous === undefined) delete process.env.ROOST_DATA_DIR;
    else process.env.ROOST_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
