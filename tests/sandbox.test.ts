import assert from "node:assert/strict";
import { test } from "node:test";
import { codexSandbox } from "../src/server/codex/sandbox.server";

test("the existing sandbox remains the default; dedicated VM access is explicit", () => {
  assert.equal(codexSandbox(""), "workspace-write");
  assert.equal(codexSandbox("workspace-write"), "workspace-write");
  assert.equal(codexSandbox("danger-full-access"), "danger-full-access");
  assert.throws(() => codexSandbox("danger-ful-access"), /ROOST_CODEX_SANDBOX/);
});
