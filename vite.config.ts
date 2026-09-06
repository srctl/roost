import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
