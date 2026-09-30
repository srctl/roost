import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Render the existing Jobs content with fixture data; never load app/server code.
const root = fileURLToPath(new URL(".", import.meta.url));
const original = readFileSync(
  new URL("../../../src/routes/agents.$agentId_.jobs.tsx", import.meta.url),
  "utf8",
);
const helpers = original.slice(
  original.indexOf("const statusLabels"),
  original.indexOf("function JobsPage"),
);
const content = original
  .slice(original.indexOf("function AgentJobs"))
  .replace("function AgentJobs", "export function Baseline")
  .replace("<AgentHeader agent={agent} />", "")
  .replace(
    "Awaited<ReturnType<typeof loadJobs>>",
    "{ ok: true; value: CodingJob[] }",
  );
writeFileSync(
  `${root}.baseline.tsx`,
  `
// @ts-nocheck -- generated existing UI with inert fixture boundaries.
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { Button } from "../../../src/components/ui/button";
import type { Agent } from "../../../src/features/agents/schema";
import type { CodingJob, CodingJobStatus } from "../../../src/features/coding/schema";
import { colors } from "../../../src/styles/tokens.stylex";
const router = { invalidate: async (_options?: unknown) => {} };
const useRouter = () => router;
const Route = { id: "fixture" };
const stopCodingJob = async (_input: unknown) => ({ ok: false, error: "Fixture only: no worker can be stopped." });
const Link = ({ children }: { children: React.ReactNode }) => <span>{children}</span>;
${helpers}\n${content}`,
);
export default defineConfig({
  root,
  plugins: [stylex.vite({ useCSSLayers: true }), react()],
  server: { host: "127.0.0.1", port: 4178, strictPort: true },
  build: { outDir: "/tmp/roost-coding-view-build", emptyOutDir: true },
});
