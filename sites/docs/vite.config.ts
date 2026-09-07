import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { loadDocuments, renderPage, searchIndex } from "./src/render.tsx";

const siteRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(siteRoot, "../..");

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, siteRoot, "ROOST_");
  const websiteUrl =
    env.ROOST_WEBSITE_URL ||
    (command === "serve"
      ? "http://localhost:4173"
      : "https://github.com/srctl/roost");
  const options = { websiteUrl, origin: env.ROOST_DOCS_URL };
  const documents = () => loadDocuments(resolve(repositoryRoot, "docs"));
  const documentation: Plugin = {
    name: "roost-static-documentation",
    configureServer(server) {
      server.watcher.add(resolve(repositoryRoot, "docs"));
      server.watcher.on("change", (path) => {
        if (path.startsWith(resolve(repositoryRoot, "docs"))) {
          server.ws.send({ type: "full-reload" });
        }
      });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost")
          .pathname;
        if (pathname === "/search-index.json") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(searchIndex(documents())));
          return;
        }
        if (
          pathname.startsWith("/@") ||
          pathname.startsWith("/src/") ||
          pathname.startsWith("/node_modules/") ||
          /\.(svg|ico|css|js|map)$/.test(pathname)
        ) {
          next();
          return;
        }
        const pages = documents();
        const slug = pathname.replace(/^\/+|\/+$/g, "") || "index";
        const page = pages.find((candidate) => candidate.slug === slug);
        response.statusCode = page ? 200 : 404;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(
          renderPage(page, pages, {
            ...options,
            script: "/src/client.ts",
            stylesheet: "/src/style.css",
            development: true,
          }),
        );
      });
    },
    configurePreviewServer(server) {
      return () => {
        server.middlewares.use((request, response, next) => {
          // Vite rewrites directory routes to index.html before this hook,
          // then serves their HTML after it. Let those real pages through.
          const pathname = new URL(request.url || "/", "http://localhost")
            .pathname;
          const outputRoot = resolve(siteRoot, "dist");
          const file = resolve(outputRoot, `.${pathname}`);
          if (
            file.startsWith(`${outputRoot}/`) &&
            file.endsWith(".html") &&
            existsSync(file)
          ) {
            next();
            return;
          }
          response.statusCode = 404;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(readFileSync(resolve(siteRoot, "dist/404.html")));
        });
      };
    },
    generateBundle(_outputOptions, bundle) {
      const entry = Object.values(bundle).find(
        (output) => output.type === "chunk" && output.isEntry,
      );
      if (!entry) throw new Error("Documentation client entry was not built.");
      const pages = documents();
      const pageOptions = {
        ...options,
        script: `/${entry.fileName}`,
        stylesheet: "/assets/docs.css",
      };
      for (const page of pages) {
        this.emitFile({
          type: "asset",
          fileName:
            page.slug === "index" ? "index.html" : `${page.slug}/index.html`,
          source: renderPage(page, pages, pageOptions),
        });
      }
      this.emitFile({
        type: "asset",
        fileName: "404.html",
        source: renderPage(undefined, pages, pageOptions),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/docs.css",
        source: readFileSync(resolve(siteRoot, "src/style.css"), "utf8"),
      });
      this.emitFile({
        type: "asset",
        fileName: "search-index.json",
        source: JSON.stringify(searchIndex(pages)),
      });
    },
  };

  return {
    root: siteRoot,
    appType: "mpa",
    plugins: [documentation],
    server: { host: "127.0.0.1", port: 4174, strictPort: true },
    preview: { host: "127.0.0.1", port: 4174, strictPort: true },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rolldownOptions: { input: resolve(siteRoot, "src/client.ts") },
    },
  };
});
