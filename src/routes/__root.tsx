import * as stylex from "@stylexjs/stylex";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { App } from "../app";
import { getAgents } from "../features/agents/functions";
import { getSidebarPreferences } from "../features/settings/sidebar-functions";
import stylesheet from "../styles/reset.css?url";
import { colors } from "../styles/tokens.stylex";

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
      { name: "color-scheme", content: "light dark" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "apple-mobile-web-app-title", content: "Roost" },
    ],
    links: [
      { rel: "stylesheet", href: stylesheet },
      {
        rel: "manifest",
        href: "/manifest.webmanifest",
        crossOrigin: "use-credentials",
      },
      { rel: "icon", href: "/icons/roost.svg?v=2", type: "image/svg+xml" },
      // iOS fetches home-screen icons without the private proxy's session cookie.
      // Only these public branding assets are hosted outside this installation.
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "https://raw.githubusercontent.com/srctl/roost/v0.1.10/public/icons/apple-touch-icon.png",
      },
      ...(import.meta.env.DEV
        ? [{ rel: "stylesheet", href: "/virtual:stylex.css" }]
        : []),
    ],
    // Start owns the HTML shell, so Vite's transformIndexHtml hook does not run.
    scripts: import.meta.env.DEV
      ? [{ type: "module", src: "/@id/virtual:stylex:runtime" }]
      : [],
  }),
  loader: async () => {
    const [agents, sidebarPreferences] = await Promise.all([
      getAgents(),
      getSidebarPreferences(),
    ]);
    return { ...agents, sidebarPreferences };
  },
  headers: () => ({ "Cache-Control": "private, no-store" }),
  component: App,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" {...stylex.props(styles.document)}>
      <head>
        <HeadContent />
        {/* Router metadata deduplicates by name; both theme variants are needed. */}
        <meta
          name="theme-color"
          content="#FFFFFF"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#20221E"
          media="(prefers-color-scheme: dark)"
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const styles = stylex.create({
  document: {
    backgroundColor: colors.background,
    color: colors.foreground,
    colorScheme: "light dark",
  },
});
