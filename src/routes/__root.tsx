import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { App } from "../app";
import { getAgents } from "../features/agents/functions";
import stylesheet from "../styles/reset.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { title: "Roost" },
      { name: "description", content: "Roost — a home for your AI agents." },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      ...(import.meta.env.DEV
        ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }]
        : []),
    ],
    // Start owns the HTML shell, so Vite's transformIndexHtml hook does not run.
    scripts: import.meta.env.DEV
      ? [{ type: "module", src: "/@id/virtual:stylex:runtime" }]
      : [],
  }),
  loader: () => getAgents(),
  component: App,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
