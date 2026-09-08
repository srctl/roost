import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const tools =
  process.env.RESEARCH_TOOLS || "/tmp/unified-task-tools/node_modules";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "@excalidraw/excalidraw/index.css",
        replacement: `${tools}/@excalidraw/excalidraw/dist/prod/index.css`,
      },
      {
        find: "@excalidraw/excalidraw",
        replacement: `${tools}/@excalidraw/excalidraw/dist/prod/index.js`,
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4283,
    strictPort: true,
    fs: {
      allow: [fileURLToPath(new URL("../../../", import.meta.url)), tools],
    },
  },
});
