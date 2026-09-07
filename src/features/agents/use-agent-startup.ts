import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import type { Agent } from "./schema";
import { lastAgentKey } from "./startup";

export function useAgentStartup(agents: readonly Agent[] | undefined) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useEffect(() => {
    if (!agents) return;
    const current = agents.find(
      (agent) =>
        pathname === `/agents/${agent.id}` ||
        pathname === `/agents/${agent.id}/dashboard`,
    );
    if (!current) return;
    try {
      // The server restores this hint only for a full-page visit to Home.
      // Explicit agent and dashboard URLs always choose their own destination.
      // biome-ignore lint/suspicious/noDocumentCookie: This non-sensitive launch hint is read during server rendering.
      document.cookie = `${lastAgentKey}=${current.id}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    } catch {
      return;
    }
  }, [agents, pathname]);
}
