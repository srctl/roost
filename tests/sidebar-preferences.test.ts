import assert from "node:assert/strict";
import { test } from "node:test";
import { readSidebarPreferences } from "../src/features/settings/sidebar-preferences";

test("sidebar cookies restore layout and reject malformed widths", () => {
  assert.deepEqual(readSidebarPreferences("true", "300"), {
    collapsed: true,
    width: 300,
  });
  assert.deepEqual(readSidebarPreferences("false", "240"), {
    collapsed: false,
    width: 240,
  });
  assert.deepEqual(readSidebarPreferences(undefined, undefined), {
    collapsed: false,
    width: 216,
  });
  for (const width of [
    "",
    "NaN",
    "Infinity",
    "300px",
    "-10",
    "250.5",
    "1e3",
    " ",
  ])
    assert.equal(readSidebarPreferences("invalid", width).width, 216);
  assert.equal(readSidebarPreferences("invalid", "300").collapsed, false);
  assert.equal(readSidebarPreferences("true", "10").width, 180);
  assert.equal(readSidebarPreferences("true", "99999").width, 360);
});
