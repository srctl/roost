import assert from "node:assert/strict";
import type { JexoTest } from "jexo";
import {
  clickStep,
  editName,
  fillName,
  openSettings,
  originalName,
  startUrl,
} from "./support";

export default {
  name: "Cancel an agent rename",
  startUrl: startUrl(),
  goal: "Open Jexo Scout settings, edit its display name to Cancelled name, cancel the edit, and reopen the display name editor. Stop with the original name in the editor.",
  inputs: { name: "Cancelled name" },
  stepsInOrder: true,
  requiredSteps: [
    openSettings(),
    editName(),
    fillName(),
    clickStep("Cancel"),
    editName("reopen-name-editor"),
  ],
  checks: [
    {
      name: "Cancel preserves the original name",
      async check({ page }) {
        assert.equal(
          await page
            .getByRole("textbox", { name: "Display name", exact: true })
            .inputValue(),
          originalName,
        );
        assert.equal(
          await page
            .getByRole("heading", {
              name: `${originalName} settings`,
              exact: true,
            })
            .count(),
          1,
        );
      },
    },
  ],
  limits: { maxActions: 10, maxHandoffs: 0, timeoutMs: 60000 },
} satisfies JexoTest;
