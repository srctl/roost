import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

if (process.platform !== "darwin")
  throw new Error("The first desktop package targets macOS.");
const require = createRequire(import.meta.url);
const electron = dirname(require.resolve("electron/package.json"));
const output = resolve(
  process.env.ROOST_DESKTOP_OUTPUT_DIR || "output/desktop",
);
const finalBundle = join(output, "Roost Desktop.app");
const archive = join(output, "Roost Desktop-macOS.zip");
if (existsSync(finalBundle) || existsSync(archive))
  throw new Error(
    `A package already exists at ${finalBundle}. Choose a new output directory.`,
  );
mkdirSync(output, { recursive: true });
const staging = mkdtempSync(join(tmpdir(), "roost-desktop-package-"));
// Leave the app suffix off while signing so Finder does not attach folder
// metadata during verification. The final bundle and archive use .app.
const bundle = join(staging, "Roost Desktop");
try {
  cpSync(join(electron, "dist/Electron.app"), bundle, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const resources = join(bundle, "Contents/Resources");
  copyFileSync("dist/Roost.icns", join(resources, "Roost.icns"));
  const appDirectory = join(resources, "app");
  mkdirSync(appDirectory, { recursive: true });
  cpSync("dist", join(appDirectory, "dist"), {
    recursive: true,
    filter: (path) => !path.includes("swift-cache"),
  });
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  writeFileSync(
    join(appDirectory, "package.json"),
    JSON.stringify({
      name: "roost-desktop",
      productName: "Roost Desktop",
      version: manifest.version,
      main: "dist/main.cjs",
    }),
  );
  const plist = join(bundle, "Contents/Info.plist");
  function setPlist(key, value) {
    let exists = true;
    try {
      execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], {
        stdio: "ignore",
      });
    } catch {
      exists = false;
    }
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      exists ? `Set :${key} ${value}` : `Add :${key} string ${value}`,
      plist,
    ]);
  }
  for (const [key, value] of Object.entries({
    CFBundleIconFile: "Roost.icns",
    CFBundleName: "Roost Desktop",
    CFBundleDisplayName: "Roost Desktop",
    CFBundleIdentifier: "dev.roost.desktop",
    CFBundleShortVersionString: manifest.version,
  })) {
    setPlist(key, value);
  }
  for (const [key, value] of Object.entries({
    NSScreenCaptureUsageDescription:
      "Let your selected Roost agent see this Mac during a computer session.",
    NSAppleEventsUsageDescription:
      "Let Roost interact with applications you authorize.",
  })) {
    setPlist(key, value);
  }
  // Finder metadata on copied app/framework folders is not a code-signing resource.
  // Remove only those attributes from this newly generated bundle.
  for (const attribute of ["com.apple.FinderInfo", "com.apple.ResourceFork"]) {
    execFileSync("xattr", ["-dr", attribute, bundle]);
  }
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], {
    stdio: "inherit",
  });
  execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], {
    stdio: "inherit",
  });
  renameSync(bundle, finalBundle);
  execFileSync("ditto", [
    "-c",
    "-k",
    "--keepParent",
    "--norsrc",
    "--noextattr",
    finalBundle,
    archive,
  ]);
  console.log(finalBundle);
  console.log(archive);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
