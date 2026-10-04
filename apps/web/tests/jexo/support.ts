import assert from "node:assert/strict";
import type { JexoTest } from "jexo";

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

export function clickStep(
  name: string,
  id = name,
): NonNullable<JexoTest["requiredSteps"]>[number] {
  return {
    id,
    description: `Click ${name}`,
    match: (action) => action.kind === "click" && action.target.name === name,
  };
}

export const openSettings = () => clickStep(`Settings for ${originalName}`);
export const editName = (id = "Edit display name") =>
  clickStep("Edit display name", id);
export const fillName = (): NonNullable<JexoTest["requiredSteps"]>[number] => ({
  id: "fill-name",
  description: "Type the declared name into Display name",
  match: (action) =>
    action.kind === "fill" &&
    action.target.name === "Display name" &&
    action.inputName === "name",
});
