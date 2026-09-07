import { useEffect, useSyncExternalStore } from "react";
import { getDashboardSetting } from "./functions";

let enabled = false;
let requested = false;
let revision = 0;
const subscribers = new Set<() => void>();

export function updateDashboardPreference(value: boolean) {
  revision++;
  enabled = value;
  for (const notify of subscribers) notify();
}

export function useDashboardsEnabled() {
  const value = useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => enabled,
    () => false,
  );
  useEffect(() => {
    if (requested) return;
    requested = true;
    const load = () => {
      const startedAt = revision;
      void getDashboardSetting()
        .then((result) => {
          if (result.ok && startedAt === revision)
            updateDashboardPreference(result.value.enabled);
        })
        .catch(() => {
          requested = false;
        });
    };
    // Keep optional navigation off the initial conversation's critical path.
    if ("requestIdleCallback" in window)
      window.requestIdleCallback(load, { timeout: 2000 });
    else setTimeout(load, 500);
  }, []);
  return value;
}
