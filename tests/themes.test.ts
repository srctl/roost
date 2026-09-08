import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultTheme,
  readThemePreference,
  serializeTheme,
  themeModes,
  themeNames,
  themePalettes,
} from "../src/features/settings/themes";

test("theme cookies validate untrusted values and round-trip every preset/mode", () => {
  for (const value of [
    undefined,
    "",
    "rose-pine",
    "unknown:light",
    "default:sepia",
    "__proto__:dark",
    "catppuccin:dark:extra",
    "<script>:light",
  ]) {
    assert.deepEqual(readThemePreference(value), defaultTheme);
  }
  for (const preset of Object.keys(themeNames) as (keyof typeof themeNames)[]) {
    for (const mode of themeModes) {
      assert.deepEqual(readThemePreference(serializeTheme({ preset, mode })), {
        preset,
        mode,
      });
    }
  }
});

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}
test("custom palettes keep normal text and accent labels readable on app surfaces", () => {
  for (const [preset, variants] of Object.entries(themePalettes)) {
    for (const [mode, palette] of Object.entries(variants)) {
      for (const value of Object.values(palette))
        assert.match(value, /^#[\da-f]{6}$/i);
      for (const surface of [
        "background",
        "sidebar",
        "surface",
        "selected",
        "bubble",
      ] as const) {
        assert.ok(
          contrast(palette.foreground, palette[surface]) >= 4.5,
          `${preset}/${mode}: foreground on ${surface}`,
        );
        // Original muted colors are preserved; new palettes meet WCAG AA.
        if (preset !== "default")
          assert.ok(
            contrast(palette.muted, palette[surface]) >= 4.5,
            `${preset}/${mode}: muted on ${surface}`,
          );
      }
      assert.ok(
        contrast(palette.onAccent, palette.accent) >= 4.5,
        `${preset}/${mode}: accent label`,
      );
    }
  }
});
