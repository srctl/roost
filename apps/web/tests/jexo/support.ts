import assert from "node:assert/strict";

export const originalName = "Jexo Scout";
export const renamedName = "Jexo Explorer";

export function startUrl() {
  const value = process.env.ROOST_JEXO_START_URL;
  assert.ok(value, "Use run.ts: it creates a disposable local Roost fixture");
  const url = new URL(value);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  return value;
}
