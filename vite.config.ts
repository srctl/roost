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
    stylex.vite({ useCSSLayers: true }),
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
