import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { Agent } from "./schema";
import { lastAgentKey } from "./startup";

export function useAgentStartup(agents: readonly Agent[] | undefined) {
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const started = useRef(false);

  useEffect(() => {
    if (!agents) return;
    const initialVisit = !started.current;
    started.current = true;
    const current = agents.find((agent) => pathname === `/agents/${agent.id}`);
    let lastAgentId: string | null;
    try {
      if (current) {
        // Resolve the next launch before downloading the home page. The cookie
        // contains only an agent ID, never chat data or authorization.
        // biome-ignore lint/suspicious/noDocumentCookie: This non-sensitive launch hint also needs to work without the Cookie Store API.
        document.cookie = `${lastAgentKey}=${current.id}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      }
      if (current) localStorage.setItem(lastAgentKey, current.id);
      lastAgentId = localStorage.getItem(lastAgentKey);
    } catch {
      return;
    }
    // Restore only at startup. Home navigation and explicit deep links keep
    // their destination; missing agents and unavailable storage show the list.
    if (
      initialVisit &&
      pathname === "/" &&
      lastAgentId &&
      agents.some((agent) => agent.id === lastAgentId)
    ) {
      void router.navigate({
        to: "/agents/$agentId",
        params: { agentId: lastAgentId },
        replace: true,
      });
    }
  }, [agents, pathname, router]);
}
