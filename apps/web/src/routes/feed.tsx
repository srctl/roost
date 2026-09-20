import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FeedAction,
  FeedEntry,
  FeedReader,
} from "../components/feed-item";
import { FeedPreferences } from "../components/feed-preferences";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/primitives";
import {
  changeFeedItem,
  discussFeedItem,
  getFeed,
  refreshFeed,
} from "../features/feed/functions";
import type { FeedItem, FeedPage, FeedSettings } from "../features/feed/schema";
import { feedStyles as styles } from "../styles/feed.stylex";
import { Route as RootRoute } from "./__root";

export const Route = createFileRoute("/feed")({
  head: () => ({ meta: [{ title: "Feed · Roost" }] }),
  loader: () =>
    getFeed({ data: {} }).catch(() => ({
      ok: false as const,
      error: "Could not load your feed. Please try again.",
    })),
  headers: () => ({ "Cache-Control": "private, no-store" }),
  pendingComponent: () => (
    <p role="status" {...stylex.props(styles.loading)}>
      Loading your feed…
    </p>
  ),
  component: FeedPageView,
});

type Filter = "all" | "unread" | "saved";

function matchesFilter(item: FeedItem, filter: Filter) {
  return (
    !item.dismissed &&
    (filter !== "saved" || item.saved) &&
    (filter !== "unread" || item.readAt === null)
  );
}

function refreshLabel(page: FeedPage) {
  if (page.status.refreshing) return "Finding stories…";
  if (!page.settings.enabled) return "Automatic updates paused";
  if (!page.status.lastRefreshedAt) return "Ready for your first stories";
  return `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(page.status.lastRefreshedAt)}`;
}

function FeedPageView() {
  const initial = Route.useLoaderData();
  const root = RootRoute.useLoaderData();
  const agents = root.ok ? root.value : [];
  const [page, setPage] = useState<FeedPage | null>(
    initial.ok ? initial.value : null,
  );
  const [error, setError] = useState(initial.ok ? "" : initial.error);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [discussing, setDiscussing] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [dismissed, setDismissed] = useState<FeedItem | null>(null);
  const request = useRef(0);
  const currentFilter = useRef<Filter>(filter);
  const working = useRef(new Set<string>());
  const discussionRequests = useRef(new Map<string, string>());
  const cursor = useRef<number | null>(page?.nextCursor ?? null);
  currentFilter.current = filter;
  cursor.current = page?.nextCursor ?? null;

  const load = useCallback(
    async (nextFilter: Filter, more = false, quiet = false) => {
      const version = ++request.current;
      if (!quiet) setLoading(true);
      setError("");
      try {
        const result = await getFeed({
          data: {
            filter: nextFilter,
            ...(more && cursor.current !== null
              ? { before: cursor.current }
              : {}),
          },
        });
        if (version !== request.current) return;
        if (!result.ok) throw new Error(result.error);
        setPage((current) => ({
          ...result.value,
          items:
            more && current
              ? [
                  ...current.items,
                  ...result.value.items.filter(
                    (item) =>
                      !current.items.some(
                        (existing) => existing.id === item.id,
                      ),
                  ),
                ]
              : result.value.items,
        }));
      } catch (cause) {
        if (version === request.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your feed. Please try again.",
          );
      } finally {
        if (version === request.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!page?.status.refreshing) return;
    const timer = window.setInterval(() => {
      void load(currentFilter.current, false, true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [page?.status.refreshing, load]);

  useEffect(() => {
    if (
      !page?.settings.enabled ||
      page.status.refreshing ||
      selected ||
      preferences ||
      loading ||
      busyItem ||
      page.items.length > 30
    )
      return;
    const check = () => {
      if (document.visibilityState === "visible")
        void load(currentFilter.current, false, true);
    };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [
    page?.settings.enabled,
    page?.status.refreshing,
    page?.items.length,
    selected,
    preferences,
    loading,
    busyItem,
    load,
  ]);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  function chooseFilter(value: Filter) {
    if (value === filter || loading) return;
    setFilter(value);
    currentFilter.current = value;
    setPage((current) =>
      current ? { ...current, items: [], nextCursor: null } : current,
    );
    setDismissed(null);
    setAnnouncement("");
    void load(value);
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const result = await refreshFeed();
      if (!result.ok) throw new Error(result.error);
      setPage((current) =>
        current ? { ...current, status: result.value } : current,
      );
      await load(currentFilter.current, false, true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh your feed. Please try again.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  async function act(item: FeedItem, action: FeedAction) {
    if (working.current.has(item.id)) return;
    working.current.add(item.id);
    setBusyItem(item.id);
    setError("");
    if (action !== "read") {
      setAnnouncement("");
      if (action !== "restore") setDismissed(null);
    }
    try {
      const result = await changeFeedItem({ data: { id: item.id, action } });
      if (!result.ok) throw new Error(result.error);
      const updated = result.value;
      setPage((current) => {
        if (!current) return current;
        const exists = current.items.some((entry) => entry.id === updated.id);
        const items = exists
          ? current.items.map((entry) =>
              entry.id === updated.id ? updated : entry,
            )
          : action === "restore"
            ? [updated, ...current.items]
            : current.items;
        return {
          ...current,
          items: items.filter((entry) =>
            matchesFilter(entry, currentFilter.current),
          ),
        };
      });
      setSelected((current) =>
        current?.id === item.id
          ? updated.dismissed
            ? null
            : updated
          : current,
      );
      if (action === "dismiss" || (action === "less" && updated.dismissed)) {
        setDismissed(item);
        setAnnouncement("Dismissed from your feed.");
      } else if (action === "more")
        setAnnouncement("Preference saved. More stories like this.");
      else if (action === "less")
        setAnnouncement("Preference saved. Fewer stories like this.");
      else if (action === "save") setAnnouncement("Saved for later.");
      else if (action === "unsave") setAnnouncement("Removed from saved.");
      else if (action === "restore") {
        setDismissed(null);
        setAnnouncement("Restored to your feed.");
      } else if (action === "unread") setAnnouncement("Marked unread.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save that change. Please try again.",
      );
    } finally {
      working.current.delete(item.id);
      setBusyItem((current) => (current === item.id ? null : current));
    }
  }

  function openItem(item: FeedItem) {
    setSelected(item);
    setAnnouncement("");
    setError("");
    if (item.readAt === null) void act(item, "read");
  }

  async function discuss(item: FeedItem) {
    setDiscussing(true);
    setError("");
    try {
      const agentId = [
        page?.settings.agentId,
        item.authorAgentId,
        agents[0]?.id,
      ].find((id) => agents.some((agent) => agent.id === id));
      if (!agentId) throw new Error("Choose an agent to discuss this story.");
      const requestId =
        discussionRequests.current.get(item.id) ?? crypto.randomUUID();
      discussionRequests.current.set(item.id, requestId);
      const result = await discussFeedItem({
        data: { id: item.id, agentId, requestId },
      });
      if (!result.ok) throw new Error(result.error);
      window.location.assign(
        `/agents/${encodeURIComponent(result.value.agentId)}?conversation=${encodeURIComponent(result.value.conversationId)}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the discussion. Please try again.",
      );
      setDiscussing(false);
    }
  }

  function saved(settings: FeedSettings) {
    setPreferences(false);
    setPage((current) => (current ? { ...current, settings } : current));
    setAnnouncement("Feed preferences saved.");
    if (settings.enabled) void refresh();
    else void load(currentFilter.current, false, true);
  }

  const items = page?.items ?? [];
  const leadId = items.find((item) => item.kind !== "update")?.id;
  const busyRefresh = refreshing || !!page?.status.refreshing;

  return (
    <section aria-labelledby="feed-title" {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div>
          <h1 id="feed-title" {...stylex.props(styles.title)}>
            Feed
          </h1>
          <p {...stylex.props(styles.subtitle)}>
            Stories and updates, picked for you.
          </p>
        </div>
        <div {...stylex.props(styles.headerActions)}>
          <Button
            aria-label="Refresh feed"
            title="Refresh feed"
            disabled={!page || busyRefresh || !page.settings.enabled}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" />
            <span {...stylex.props(styles.buttonLabel)}>
              {busyRefresh ? "Refreshing…" : "Refresh"}
            </span>
          </Button>
          <Button
            aria-label="Feed sources and preferences"
            title="Feed sources and preferences"
            aria-haspopup="dialog"
            disabled={!page}
            onClick={() => setPreferences(true)}
          >
            <Icon name="settings" />
            <span {...stylex.props(styles.buttonLabel)}>Sources</span>
          </Button>
        </div>
      </header>
      <div {...stylex.props(styles.toolbar)}>
        <fieldset aria-label="Filter feed" {...stylex.props(styles.filters)}>
          {(["all", "unread", "saved"] as const).map((value) => (
            <Button
              key={value}
              aria-pressed={filter === value}
              disabled={loading}
              onClick={() => chooseFilter(value)}
              xstyle={[
                styles.filter,
                filter === value && styles.selectedFilter,
              ]}
            >
              {value === "all"
                ? "For you"
                : value === "unread"
                  ? "Unread"
                  : "Saved"}
            </Button>
          ))}
        </fieldset>
        <p role="status" {...stylex.props(styles.status)}>
          {loading ? "Loading stories…" : page ? refreshLabel(page) : ""}
        </p>
      </div>
      {error && (
        <div role="alert" {...stylex.props(styles.notice)}>
          <p {...stylex.props(styles.error)}>{error}</p>
          <Button onClick={() => void load(filter)}>Try again</Button>
        </div>
      )}
      {page?.status.lastError && !error && (
        <div role="status" {...stylex.props(styles.notice)}>
          <p {...stylex.props(styles.error)}>{page.status.lastError}</p>
          <Button onClick={() => setPreferences(true)}>Check sources</Button>
        </div>
      )}
      {announcement && !selected && (
        <div role="status" {...stylex.props(styles.notice)}>
          <span>{announcement}</span>
          {dismissed && (
            <Button onClick={() => void act(dismissed, "restore")}>Undo</Button>
          )}
        </div>
      )}
      {page && !page.settings.enabled && items.length > 0 && (
        <div {...stylex.props(styles.notice)}>
          Your feed is paused.
          <Button onClick={() => setPreferences(true)}>
            Resume in preferences
          </Button>
        </div>
      )}
      <div aria-busy={loading} {...stylex.props(styles.stream)}>
        {items.map((item) => (
          <FeedEntry
            key={item.id}
            item={item}
            lead={item.id === leadId}
            busy={busyItem === item.id}
            onOpen={openItem}
            onAction={(entry, action) => void act(entry, action)}
          />
        ))}
      </div>
      {page && !items.length && !loading && (
        <div {...stylex.props(styles.empty)}>
          <div {...stylex.props(styles.emptyIcon)}>
            <Icon name={filter === "saved" ? "bookmark" : "feed"} size={30} />
          </div>
          <h2 {...stylex.props(styles.emptyTitle)}>
            {filter === "saved"
              ? "Keep the stories you want to return to."
              : filter === "unread"
                ? "You're all caught up."
                : busyRefresh
                  ? "Your first stories are on their way."
                  : page.settings.enabled
                    ? "No stories yet."
                    : "Your feed starts here."}
          </h2>
          <p {...stylex.props(styles.emptyText)}>
            {filter === "saved"
              ? "Save an article, story, or personal update and it will be waiting here."
              : filter === "unread"
                ? "New stories and important updates will appear here as they arrive."
                : busyRefresh
                  ? "Roost is checking your sources and choosing stories for your feed. You can keep exploring while it works."
                  : page.settings.enabled
                    ? "Your feed has no stories yet. Check your sources or refresh to look for something worth reading."
                    : "Follow local publications, explore your interests, and bring important personal updates into one shared feed."}
          </p>
          {filter === "all" ? (
            <Button
              onClick={() => setPreferences(true)}
              xstyle={styles.primary}
            >
              {page.settings.enabled ? "Manage sources" : "Set up your feed"}
            </Button>
          ) : (
            <Button
              onClick={() => chooseFilter("all")}
              xstyle={styles.secondary}
            >
              Browse your feed
            </Button>
          )}
          {filter === "all" && !page.settings.enabled && (
            <div {...stylex.props(styles.emptySources)}>
              <span>Capitol Hill Seattle Blog</span>
              <span>The Seattle Times</span>
              <span>Your connected sources</span>
            </div>
          )}
        </div>
      )}
      {loading && !items.length && (
        <p role="status" {...stylex.props(styles.loading)}>
          Loading your feed…
        </p>
      )}
      {page?.nextCursor !== null && page && items.length > 0 && (
        <div {...stylex.props(styles.loadMore)}>
          <Button
            disabled={loading}
            onClick={() => void load(filter, true)}
            xstyle={styles.secondary}
          >
            {loading ? "Loading…" : "More stories"}
            <Icon name="arrow-down" size={14} />
          </Button>
        </div>
      )}
      {preferences && page && (
        <FeedPreferences
          settings={page.settings}
          agents={agents}
          onClose={() => setPreferences(false)}
          onSaved={saved}
        />
      )}
      {selected && (
        <FeedReader
          item={selected}
          busy={busyItem === selected.id}
          discussing={discussing}
          canDiscuss={agents.length > 0}
          error={error}
          announcement={announcement}
          onClose={() => {
            setSelected(null);
            setError("");
          }}
          onAction={(item, action) => void act(item, action)}
          onDiscuss={(item) => void discuss(item)}
        />
      )}
    </section>
  );
}
