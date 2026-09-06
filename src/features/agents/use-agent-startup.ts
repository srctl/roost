import { useEffect, useRef } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Effect } from "effect";
import type { Agent } from "./schema";

const key = "roost.lastAgentId";

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
    const lastAgentId = Effect.runSync(
      Effect.try(() => {
        if (current) localStorage.setItem(key, current.id);
        return localStorage.getItem(key);
      }).pipe(Effect.orElseSucceed(() => null)),
    );
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
