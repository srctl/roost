import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Client-only fixture entry: never load the application server or worker plugin.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 4322,
    strictPort: true,
    allowedHosts: ["roost-dev.exe.xyz"],
  },
  build: { outDir: "/tmp/jobs-preview-build", emptyOutDir: true },
});
