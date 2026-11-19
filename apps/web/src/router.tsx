import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
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
