import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getAgentActivity } from "./functions";
import type { AgentActivity } from "../../server/agents/activity.server";

const Context = createContext<Record<string, AgentActivity>>({});

export const useAgentActivity = () => useContext(Context);

export function AgentActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<Record<string, AgentActivity>>({});
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (!document.hidden) {
        const result = await getAgentActivity().catch(() => null);
        if (cancelled) return;
        setActivity(result?.ok ? result.value : {});
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2000);
    };

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return <Context.Provider value={activity}>{children}</Context.Provider>;
}
