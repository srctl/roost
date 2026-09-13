import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { mergeConfig, type Plugin } from "vite";
import appConfig from "../../../vite.config";

const directory = process.env.ROOST_DATA_DIR;
if (
  !directory?.startsWith("/tmp/roost-jobs-app-preview-") ||
  readFileSync(join(directory, "fixture-only"), "utf8") !== "jobs-preview"
)
  throw new Error(
    "Jobs preview requires its isolated seeded fixture directory",
  );
const agentId = "11111111-1111-4111-8111-111111111111";
const fixtureRoutes: Plugin = {
  name: "jobs-preview-fixture-routes",
  enforce: "pre",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith("/evidence/")) {
        const relative = decodeURIComponent(
          req.url.split("?")[0]!.slice("/evidence/".length),
        );
        const path = resolve("/tmp/jobs-preview-evidence", relative);
        if (
          !path.startsWith("/tmp/jobs-preview-evidence/") ||
          !/\.(html|png|webm)$/.test(path) ||
          !existsSync(path)
        ) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader(
          "Content-Type",
          path.endsWith(".html")
            ? "text/html"
            : path.endsWith(".png")
              ? "image/png"
              : "video/webm",
        );
        res.end(readFileSync(path));
        return;
      }
      if (req.url === "/") {
        res.writeHead(302, { Location: `/agents/${agentId}/jobs` });
        res.end();
        return;
      }
      if (req.url === "/fixture-preview") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated job preview</title><body style="font:14px system-ui;padding:32px"><h1>Simulated job preview</h1><p>This destination represents a running preview. The parent Jobs workspace is the real Roost app using isolated test data.</p><p>No external worker, repository or deployment is connected.</p><a href="/">Return to Jobs</a></body></html>',
        );
        return;
      }
      next();
    });
  },
};
export default mergeConfig(appConfig, {
  root: resolve("."),
  server: {
    host: "0.0.0.0",
    port: 4322,
    strictPort: true,
    allowedHosts: ["roost-dev.exe.xyz"],
  },
  resolve: {
    alias: [
      {
        find: /^.*\/herdr\.server(?:\.ts)?$/,
        replacement: resolve("tests/fixtures/jobs-preview/herdr.server.ts"),
      },
    ],
  },
  plugins: [fixtureRoutes],
});
