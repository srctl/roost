import assert from "node:assert/strict";
import { test } from "jexo";
import { originalName, startUrl } from "./support.ts";

test("Cancel an agent rename", (ai, config) => {
  config.start(startUrl());
  config.inputs({ name: "Cancelled name" });
  config.limits({ maxActions: 10, maxHandoffs: 0, timeoutMs: 60000 });
  ai.goal(
    "Open Jexo Scout settings, edit its display name to Cancelled name, cancel the edit, and reopen the display name editor. Stop with the original name in the editor.",
  );
  ai.step(`Click Settings for ${originalName}`);
  ai.step("Click Edit display name");
  ai.step("Type the declared name into Display name");
  ai.step("Click Cancel");
  ai.step("Click Edit display name");
  ai.verify.code("Cancel preserves the original name", async ({ page }) => {
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
  });
});
