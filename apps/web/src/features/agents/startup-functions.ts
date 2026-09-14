import { createServerFn } from "@tanstack/react-start";
import { getCookie, setResponseHeader } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { listAgents } from "../../server/agents/store.server";
import { available } from "../../server/available";
import { lastAgentKey } from "./startup";

export const getStartupAgent = createServerFn({ method: "GET" })
  .middleware([available])
  .handler(async () => {
    // Startup is a device preference; never let a proxy cache its redirect.
    setResponseHeader("Cache-Control", "private, no-store");
    const id = getCookie(lastAgentKey);
    if (!id) return null;
    const agents = await Effect.runPromise(listAgents());
    return agents.some((agent) => agent.id === id) ? id : null;
  });
