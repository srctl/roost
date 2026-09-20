import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const require = createRequire(import.meta.url);
await build({
  configFile: false,
  publicDir: false,
  resolve: {
    alias: {
      "@novnc/novnc/lib/rfb.js": require.resolve("@novnc/novnc/lib/rfb.js"),
    },
  },
  build: {
    emptyOutDir: false,
    outDir: fileURLToPath(
      new URL("../../ios/Roost/Resources", import.meta.url),
    ),
    lib: {
      entry: fileURLToPath(
        new URL("../../ios/desktop/viewer.js", import.meta.url),
      ),
      name: "RoostDesktop",
      formats: ["iife"],
      fileName: () => "DesktopViewer.js",
    },
    minify: true,
    sourcemap: false,
  },
});
