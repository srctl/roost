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
