import { useSyncExternalStore } from "react";
import { Route } from "../../routes/__root";

let enabled: boolean | undefined;
const subscribers = new Set<() => void>();

export function updateDashboardPreference(value: boolean) {
  enabled = value;
  for (const notify of subscribers) notify();
}

export function useDashboardsEnabled() {
  const initial = Route.useLoaderData().dashboardsEnabled;
  return useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => enabled ?? initial,
    () => initial,
  );
}
