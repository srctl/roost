import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    // Agent tabs preload each other, so keep visited and preloaded loader data
    // long enough that switching tabs renders from cache and revalidates.
    defaultGcTime: 30 * 60_000,
    defaultPreloadGcTime: 30 * 60_000,
    // Conversations follow their latest message and manage older-history scroll.
    scrollRestoration: ({ location }) =>
      !/^\/agents\/[0-9a-f-]{36}(?:\/dashboard)?$/i.test(location.pathname),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
