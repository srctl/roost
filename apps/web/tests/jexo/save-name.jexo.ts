import assert from "node:assert/strict";
import { test } from "jexo";
import { originalName, renamedName, startUrl } from "./support.ts";

test("Save and persist an agent rename", (ai, config) => {
  config.start(startUrl());
  config.inputs({ name: `  ${renamedName}  ` });
  config.limits({ maxActions: 10, maxHandoffs: 0, timeoutMs: 60000 });
  ai.goal(
    "Open Jexo Scout settings, edit the display name to the supplied name, save it, and close agent settings. Stop back in the conversation with Jexo Explorer.",
  );
  ai.step(`Click Settings for ${originalName}`);
  ai.step("Click Edit display name");
  ai.step("Type the declared name into Display name");
  ai.step("Click Save");
  ai.step("Click Close agent settings");
  ai.verify.code(
    "Trimmed name survives reload and conversation URL is preserved",
    async ({ page }) => {
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
  );
});
