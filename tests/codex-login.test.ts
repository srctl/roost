import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import {
  startLogin,
  getLogin,
  cancelLogin,
  closeLogin,
} from "../src/server/codex/login.server";
import { codexErrorMessage } from "../src/server/codex/auth-errors.server";
import { CODEX_SIGN_IN_REQUIRED } from "../src/features/auth/schema";

test("device login survives requests, shares pending flow, and clears codes on completion or cancellation", async () => {
  const home = await mkdtemp(join(tmpdir(), "roost-login-"));
  const previousPath = process.env.PATH;
  process.env.PATH = `${dirname(process.execPath)}:${previousPath ?? ""}`;
  const previousHome = process.env.CODEX_HOME;
  const previousBinary = process.env.ROOST_CODEX_BINARY;
  process.env.CODEX_HOME = home;
  process.env.ROOST_CODEX_BINARY = fileURLToPath(
    new URL("./fixtures/login-server.mjs", import.meta.url),
  );
  const mode = (value: string) => writeFile(join(home, "mode"), value);
  const settle = async () => {
    for (let i = 0; i < 100 && getLogin().status === "pending"; i++)
      await setTimeout(20);
    assert.notEqual(getLogin().status, "pending");
  };
  try {
    await mode("waiting");
    const [first, concurrent] = await Promise.all([startLogin(), startLogin()]);
    assert.deepEqual(first, concurrent);
    assert.equal(first.status, "pending");
    assert.deepEqual(await startLogin(), first);
    await cancelLogin("stale-login");
    assert.deepEqual(getLogin(), first);
    await mode("success");
    await settle();
    assert.deepEqual(getLogin(), { status: "connected" });
    await mode("waiting");
    await startLogin();
    await cancelLogin("test-login");
    assert.deepEqual(getLogin(), { status: "idle" });
    assert.equal(await readFile(join(home, "cancelled"), "utf8"), "yes");
    const pid = Number(await readFile(join(home, "pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
    await mode("early");
    assert.deepEqual(await startLogin(), { status: "connected" });
    for (const failure of ["failure", "exit"]) {
      await mode("waiting");
      await startLogin();
      await mode(failure);
      await settle();
      assert.equal(getLogin().status, "error");
      assert.doesNotMatch(
        JSON.stringify(getLogin()),
        /TEST-1234|private upstream/,
      );
    }
  } finally {
    await closeLogin();
    process.env.PATH = previousPath;
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    if (previousBinary === undefined) delete process.env.ROOST_CODEX_BINARY;
    else process.env.ROOST_CODEX_BINARY = previousBinary;
    await rm(home, { recursive: true, force: true });
  }
});

test("Codex authentication failures are actionable without exposing provider details", () => {
  for (const message of [
    "unexpected status 401 Unauthorized: Could not parse your authentication token",
    "Your access token could not be refreshed. Please log out and sign in again.",
  ]) {
    assert.equal(
      codexErrorMessage({ message }, "Run failed"),
      CODEX_SIGN_IN_REQUIRED,
    );
  }
  assert.equal(
    codexErrorMessage({ message: "private provider error" }, "Run failed"),
    "Run failed",
  );
  assert.equal(codexErrorMessage(null, "Run failed"), "Run failed");
});
