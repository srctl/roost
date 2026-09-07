import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { agentContentType, agentResources } from "./src/agent-docs.ts";
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
      server.watcher.on("all", (event, path) => {
        if (
          ["add", "change", "unlink"].includes(event) &&
          path.startsWith(resolve(repositoryRoot, "docs"))
        ) {
          server.ws.send({ type: "full-reload" });
        }
      });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost")
          .pathname;
        if (
          pathname.endsWith(".md") ||
          /^\/llms(?:-full)?\.txt$/.test(pathname)
        ) {
          const content = agentResources(documents(), options.origin).get(
            pathname.slice(1),
          );
          response.statusCode = content === undefined ? 404 : 200;
          response.setHeader("Content-Type", agentContentType(pathname));
          response.end(content ?? "Documentation not found.\n");
          return;
        }
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
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost")
          .pathname;
        if (!/^\/[\w-]+\.(?:md|txt)$/.test(pathname)) {
          next();
          return;
        }
        const file = resolve(siteRoot, "dist", pathname.slice(1));
        const exists = existsSync(file);
        response.statusCode = exists ? 200 : 404;
        response.setHeader("Content-Type", agentContentType(pathname));
        response.end(
          exists ? readFileSync(file) : "Documentation not found.\n",
        );
      });
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
      for (const [fileName, source] of agentResources(pages, options.origin)) {
        this.emitFile({ type: "asset", fileName, source });
      }
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
