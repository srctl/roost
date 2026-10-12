import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts", "src/preload.ts"],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: true,
});
for (const file of ["panel.html", "panel.css", "panel.js"])
  copyFileSync(`src/${file}`, `dist/${file}`);
copyFileSync("../web/src/assets/roost.svg", "dist/roost.svg");
execFileSync(
  "python3",
  ["scripts/icons.py", "../web/src/assets/roost.svg", "dist"],
  { stdio: "inherit" },
);
if (process.platform === "darwin") {
  execFileSync(
    "iconutil",
    ["-c", "icns", "dist/Roost.iconset", "-o", "dist/Roost.icns"],
    { stdio: "inherit" },
  );
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-parse-as-library",
      "-O",
      "-module-cache-path",
      "dist/swift-cache",
      "-target",
      `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx14.0`,
      "native/MacHelper.swift",
      "-o",
      "dist/roost-mac-helper",
    ],
    { stdio: "inherit" },
  );
  execFileSync("dist/roost-mac-helper", ["--self-test"], { stdio: "inherit" });
}
