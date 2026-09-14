import babel from "@rolldown/plugin-babel";
import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import { preloadStaticImports } from "./scripts/preload-static-imports";

export default defineConfig({
  server: { host: "127.0.0.1" },
  plugins: [
    preloadStaticImports(),
    // Analyze React source before StyleX and the framework transform it.
    babel({ presets: [reactCompilerPreset()] }),
    stylex.vite({
      useCSSLayers: true,
      // Shared rules must load on direct Chat/Jobs visits too. The default
      // first CSS asset may belong to a lazy route such as the Notes editor.
      cssInjectionTarget: (fileName) =>
        /(?:^|\/)reset(?:-[^/]+)?\.css$/.test(fileName),
    }),
    tanstackStart(),
    nitro({
      preset: "node-server",
      compressPublicAssets: true,
      features: { websocket: true },
      handlers: [
        {
          route: "/api/desktop/socket",
          handler: "./src/server/computer/socket.server.ts",
        },
      ],
      plugins: ["./src/server/worker-plugin.ts"],
    }),
    react(),
  ],
});
