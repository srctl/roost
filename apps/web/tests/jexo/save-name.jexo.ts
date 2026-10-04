import assert from "node:assert/strict";
import type { JexoTest } from "jexo";
import {
  clickStep,
  editName,
  fillName,
  openSettings,
  renamedName,
  startUrl,
} from "./support";

export default {
  name: "Save and persist an agent rename",
  startUrl: startUrl(),
  goal: "Open Jexo Scout settings, edit the display name to the supplied name, save it, and close agent settings. Stop back in the conversation with Jexo Explorer.",
  inputs: { name: `  ${renamedName}  ` },
  stepsInOrder: true,
  requiredSteps: [
    openSettings(),
    editName(),
    fillName(),
    clickStep("Save"),
    clickStep("Close agent settings"),
  ],
  checks: [
    {
      name: "Trimmed name survives reload and conversation URL is preserved",
      async check({ page }) {
        assert.equal(page.url(), startUrl());
        await page
          .getByRole("button", {
            name: `Settings for ${renamedName}`,
            exact: true,
          })
          .waitFor();
        await page.reload();
        await page
          .getByRole("button", {
            name: `Settings for ${renamedName}`,
            exact: true,
          })
          .waitFor();
        assert.equal(page.url(), startUrl());
        assert.equal(
          await page
            .getByRole("region", {
              name: `Conversation with ${renamedName}`,
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
