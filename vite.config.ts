import stylex from "@stylexjs/unplugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: "127.0.0.1" },
  plugins: [
    stylex.vite({ useCSSLayers: true }),
    tanstackStart(),
    nitro({
      preset: "node-server",
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
