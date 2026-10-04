import assert from "node:assert/strict";
import { test } from "jexo";
import { originalName, startUrl } from "./support.ts";

test("Reject a blank agent name", (ai, config) => {
  config.start(startUrl());
  config.inputs({ name: "   " });
  config.limits({ maxActions: 10, maxHandoffs: 0, timeoutMs: 60000 });
  ai.goal(
    "Open Jexo Scout settings, edit the display name to the supplied whitespace, and click Save. Stop when the validation error appears; keep the editor open.",
  );
  ai.step(`Click Settings for ${originalName}`);
  ai.step("Click Edit display name");
  ai.step("Type the declared name into Display name");
  ai.step("Click Save");
  ai.verify.code(
    "Blank name shows validation and keeps the original identity",
    async ({ page }) => {
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
  );
});
