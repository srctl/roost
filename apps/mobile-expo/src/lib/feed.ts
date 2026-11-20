import { useCallback, useEffect, useState } from "react";
import type { FeedItem, FeedSnapshot, RoostAPI } from "./api";

// Stories opened from the list are read from here by the reader sheet.
export const feedCache = new Map<string, FeedItem>();

export type FeedFilter = "all" | "saved";

export function useFeed(api: RoostAPI, filter: FeedFilter) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<FeedSnapshot["status"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const snapshot = await api.get<FeedSnapshot>("feed", { filter });
      for (const item of snapshot.items) feedCache.set(item.id, item);
      setItems(snapshot.items);
      setStatus(snapshot.status);
      setError(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, filter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const act = useCallback(
    async (item: FeedItem, action: "save" | "unsave" | "dismiss") => {
      // Optimistic, then reconciled with the server's copy.
      setItems((list) =>
        list.map((i) =>
          i.id === item.id
            ? {
                ...i,
                saved:
                  action === "save"
                    ? true
                    : action === "unsave"
                      ? false
                      : i.saved,
                dismissed: action === "dismiss" || i.dismissed,
              }
            : i,
        ),
      );
      try {
        const updated = await api.post<FeedItem>(`feed/items/${item.id}`, {
          action,
        });
        if (updated) {
          feedCache.set(updated.id, updated);
          setItems((list) =>
            list.map((i) => (i.id === updated.id ? updated : i)),
          );
        }
      } catch (failure) {
        setError((failure as Error).message);
        load();
      }
    },
    [api, load],
  );

  const visible = items.filter(
    (i) => !i.dismissed && (filter !== "saved" || i.saved),
  );
  return { items: visible, status, loading, error, load, act };
}

export function sectionTitle(timestamp: number, now = new Date()) {
  const date = new Date(timestamp);
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (day === today) {
    const hour = date.getHours();
    return hour < 12
      ? "This morning"
      : hour < 17
        ? "This afternoon"
        : "This evening";
  }
  if (today - day <= 25 * 3600 * 1000) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
