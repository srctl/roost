import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const env = loadEnv(mode, root, "ROOST_");
  const docs =
    env.ROOST_DOCS_URL ||
    (command === "serve"
      ? "http://localhost:4174"
      : "https://github.com/srctl/roost/blob/main/docs");
  const website = env.ROOST_WEBSITE_URL;
  const docsPage = (page: string) =>
    `${docs.replace(/\/$/, "")}/${docs.includes("github.com/") ? `${page}.md` : `${page}/`}`;
  const markdownBase = docs.includes("github.com/")
    ? "https://raw.githubusercontent.com/srctl/roost/main/docs"
    : docs.replace(/\/$/, "");
  const agentIndex = `# Roost

> A self-hosted home for persistent Codex agents, conversations, and scheduled work.

This is the public marketing site. Use the linked Markdown guides for setup and operation.
The Roost app is single-user, needs private access, and requires a running host for scheduled work.

## Start here

- [Read with an agent](${markdownBase}/for-agents.md): How to use the documentation and verify a deployment.
- [Choose a platform](${markdownBase}/deployment.md): Recommended VM route, platform requirements, and acceptance checks.
- [Deploy on exe.dev](${markdownBase}/deploy-exe-dev.md): Persistent Linux VM and private access.
- [Getting started](${markdownBase}/getting-started.md): Connect Codex and create an agent.
- [All guides](${markdownBase}/index.md): Documentation contents.
${docs.includes("github.com/") ? "" : `\n## Full documentation\n\n- [Documentation index](${markdownBase}/llms.txt): Links to every guide.\n- [Full text](${markdownBase}/llms-full.txt): All guides in one response.\n`}`;
  const escapeAttribute = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;");

  return {
    root,
    appType: "mpa",
    server: { port: 4173, strictPort: true, host: "127.0.0.1" },
    preview: { port: 4173, strictPort: true, host: "127.0.0.1" },
    plugins: [
      {
        name: "roost-public-links",
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url?.split("?")[0] !== "/llms.txt") {
              next();
              return;
            }
            response.setHeader("Content-Type", "text/plain; charset=utf-8");
            response.end(agentIndex);
          });
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "llms.txt",
            source: agentIndex,
          });
        },
        transformIndexHtml(html) {
          return html
            .replaceAll(
              "__DOCS_URL__",
              escapeAttribute(
                docs.includes("github.com/")
                  ? docsPage("index")
                  : `${docs.replace(/\/$/, "")}/`,
              ),
            )
            .replaceAll(
              "__GET_STARTED_URL__",
              escapeAttribute(docsPage("getting-started")),
            )
            .replaceAll(
              "__AUTOMATIONS_URL__",
              escapeAttribute(docsPage("automations")),
            )
            .replaceAll(
              "__COMPUTER_URL__",
              escapeAttribute(docsPage("computer")),
            )
            .replaceAll(
              "__CANONICAL__",
              website
                ? `<link rel="canonical" href="${escapeAttribute(website)}" />`
                : "",
            );
        },
      },
    ],
  };
});
