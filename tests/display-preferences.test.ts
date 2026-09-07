import assert from "node:assert/strict";
import { test } from "node:test";
import { readDisplayPreferences } from "../src/features/settings/display-preferences";

test("display cookies preserve the first-render style and validate unknown values", () => {
  assert.deepEqual(readDisplayPreferences("messages", "true"), {
    responseStyle: "messages",
    showActivityDetails: true,
  });
  for (const value of [undefined, "invalid", "false", "codex"])
    assert.deepEqual(readDisplayPreferences(value, value), {
      responseStyle: "codex",
      showActivityDetails: false,
    });
});
