import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Route } from "../../routes/__root";
import { saveAgentNavigation } from "./navigation-functions";
import { createNavigationState } from "./navigation-state";

const NavigationContext = createContext<ReturnType<
  typeof createNavigationState
> | null>(null);

export function AgentNavigationProvider({ children }: { children: ReactNode }) {
  const result = Route.useLoaderData().navigation;
  const [state] = useState(() =>
    createNavigationState(
      result.ok
        ? result.value
        : {
            sections: [],
            memberships: {},
            agentOrder: [],
            ungroupedPosition: 0,
          },
      async (change) => {
        const response = await saveAgentNavigation({ data: change });
        if (!response.ok) throw new Error(response.error);
      },
    ),
  );
  useEffect(() => {
    if (result.ok) state.sync(result.value);
  }, [result, state]);
  return (
    <NavigationContext.Provider value={state}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useAgentNavigation() {
  const state = useContext(NavigationContext);
  if (!state) throw new Error("AgentNavigationProvider is required.");
  const snapshot = useSyncExternalStore(
    state.subscribe,
    state.getSnapshot,
    state.getSnapshot,
  );
  return { ...snapshot, save: state.save };
}
