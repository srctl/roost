import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findSettings,
  readSettingsGroup,
} from "../src/features/settings/navigation";

test("unknown settings groups fall back to appearance", () => {
  for (const value of [undefined, null, "", "missing", ["account"], 1]) {
    assert.equal(readSettingsGroup(value), "appearance");
  }
  assert.equal(readSettingsGroup("notifications"), "notifications");
  assert.equal(readSettingsGroup("account"), "account");
});

test("search finds existing controls, conditional options, and vocabulary across groups", () => {
  const cases = [
    ["  THINKING  summaries ", "conversation"],
    ["tool inputs", "conversation"],
    ["messages", "conversation"],
    ["response style", "conversation"],
    ["trackers", "dashboards"],
    ["dashboard updates", "dashboards"],
    ["turn completed", "notifications"],
    ["agent updates", "notifications"],
    ["approval", "notifications"],
    ["device permission", "notifications"],
    ["passkeys", "account"],
    ["signed-in sessions", "account"],
    ["sign in", "account"],
    ["reconnect", "account"],
  ];
  for (const [query, expected] of cases) {
    assert.ok(
      findSettings(query!).some((entry) => entry.id === expected),
      query,
    );
  }
  assert.deepEqual(
    findSettings("appearance").map((entry) => entry.id),
    ["conversation", "dashboards"],
  );
  assert.deepEqual(
    findSettings("codex").map((entry) => entry.id),
    ["conversation", "account"],
  );
  assert.equal(findSettings(" \n ").length, 4);
  assert.equal(findSettings("nothing-matches-this").length, 0);
  assert.equal(findSettings("passkeys trackers").length, 0);
});
