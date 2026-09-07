import { useEffect, useLayoutEffect, useMemo, useState } from "react";

let loaded = false;

/** Records that the first client render has committed. Call once, in the shell. */
export function useMarkLoaded() {
  useEffect(() => {
    loaded = true;
  }, []);
}

/**
 * True when this component first rendered after the page finished loading.
 * Entrance animations gated on this reflect a real change the user caused,
 * instead of replaying on every server-rendered element at startup.
 */
export function useMountedAfterLoad() {
  return useState(() => loaded)[0];
}

/**
 * Tracks which ids in an ordered list arrived live, appended after the list was
 * first shown. Prepended ids (older pages) and the initial contents never count.
 * The returned set is stable for an id once it enters, so a CSS animation keyed
 * on membership plays to completion even when the list re-renders mid-flight.
 */
export function useLiveEntries(
  ids: readonly string[],
  ready = true,
): ReadonlySet<string> {
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const [live, setLive] = useState<ReadonlySet<string>>(() => new Set());
  const appended = useMemo(() => {
    if (!seen) return [];
    let last = ids.length - 1;
    while (last >= 0 && !seen.has(ids[last]!)) last--;
    return ids.slice(last + 1);
  }, [ids, seen]);
  useLayoutEffect(() => {
    if (!ready) return;
    if (!seen || ids.some((id) => !seen.has(id))) setSeen(new Set(ids));
    if (appended.length)
      setLive((current) => new Set([...current, ...appended]));
  }, [ids, ready, seen, appended]);

  return useMemo(
    () => (appended.length ? new Set([...live, ...appended]) : live),
    [live, appended],
  );
}

/**
 * Base UI skips the entrance transition for a popup that mounts already open,
 * which is how lazily loaded dialogs arrive. Holding `open` back for one effect
 * tick lets the popup mount closed and then animate in like any later opening.
 */
export function useOpenAfterMount(open: boolean) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return open && mounted;
}
