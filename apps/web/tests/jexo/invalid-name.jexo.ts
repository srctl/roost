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
  name: "Reject a blank agent name",
  startUrl: startUrl(),
  goal: "Open Jexo Scout settings, edit the display name to the supplied whitespace, and click Save. Stop when the validation error appears; keep the editor open.",
  inputs: { name: "   " },
  stepsInOrder: true,
  requiredSteps: [openSettings(), editName(), fillName(), clickStep("Save")],
  checks: [
    {
      name: "Blank name shows validation and keeps the original identity",
      async check({ page }) {
        const alert = page
          .getByRole("alert")
          .filter({ hasText: "between 1 and 60" });
        await alert.waitFor();
        assert.match(await alert.innerText(), /between 1 and 60/);
        assert.equal(
          await page
            .getByRole("textbox", { name: "Display name", exact: true })
            .count(),
          1,
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
