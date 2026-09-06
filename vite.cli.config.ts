import { defineConfig } from "vite";
export default defineConfig({
  ssr: { noExternal: ["effect"] },
  build: {
    ssr: "src/cli/main.ts",
    outDir: ".output/cli",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "roost.mjs" } },
  },
});
