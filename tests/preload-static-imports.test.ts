import assert from "node:assert/strict";
import { test } from "node:test";
import type { Rollup } from "vite";
import { expandStaticImports } from "../scripts/preload-static-imports";

test("startup preloads include static descendants once without loading lazy panels", () => {
  const chunk = (
    fileName: string,
    imports: string[],
    dynamicImports: string[] = [],
  ) =>
    ({
      type: "chunk",
      fileName,
      imports,
      dynamicImports,
    }) as Rollup.OutputChunk;
  const bundle: Rollup.OutputBundle = {
    "route.js": chunk(
      "route.js",
      ["activity.js", "shared.js"],
      ["settings.js"],
    ),
    "activity.js": chunk("activity.js", ["markdown.js", "shared.js"]),
    "markdown.js": chunk("markdown.js", ["shared.js"]),
    "shared.js": chunk("shared.js", ["activity.js"]),
    "settings.js": chunk("settings.js", ["dialog.js"]),
    "dialog.js": chunk("dialog.js", []),
  };
  expandStaticImports(bundle);
  assert.deepEqual(
    bundle["route.js"].type === "chunk" && bundle["route.js"].imports,
    ["activity.js", "shared.js", "markdown.js"],
  );
  assert.deepEqual(
    bundle["route.js"].type === "chunk" && bundle["route.js"].dynamicImports,
    ["settings.js"],
  );
  assert.deepEqual(
    bundle["markdown.js"].type === "chunk" && bundle["markdown.js"].imports,
    ["shared.js", "activity.js"],
  );
});
