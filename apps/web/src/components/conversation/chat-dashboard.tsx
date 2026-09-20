import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { dashboardMessageUI } from "../../features/dashboards/chat";
import { getChatDashboard } from "../../features/dashboards/functions";
import type { DashboardWidget } from "../../features/dashboards/schema";
import { colors } from "../../styles/tokens.stylex";
import { DashboardTrackerDrafts } from "../dashboard-tracker";
import { Button } from "../ui/button";

// Most conversations contain only text. Load charts and plan renderers only
// when a tracker is actually present.
const DashboardPlanContent = lazy(() =>
  import("../adaptive-dashboard").then((module) => ({
    default: module.DashboardPlanContent,
  })),
);

type Result = Awaited<ReturnType<typeof getChatDashboard>>;
type Snapshot = Extract<Result, { ok: true }>["value"];
type Content = { snapshot?: Snapshot; error?: string };
const Context = createContext<{
  agentId: string;
  agentName: string;
  content: Record<string, Content>;
  register: (key: string) => () => void;
  reload: (key: string) => Promise<void>;
  change: (widget: DashboardWidget) => void;
} | null>(null);

export function chatDashboardKey(ui: unknown): string | null {
  return dashboardMessageUI(ui)?.key ?? null;
}

type ProviderProps = {
  agentId: string;
  agentName: string;
  children: ReactNode;
};

// Main chat and reply panels share an agent owner. Standalone embedded chats can
// create their own owner, without replacing a shared one supplied by the page.
export function ChatDashboardProvider(props: ProviderProps) {
  const parent = useContext(Context);
  if (parent?.agentId === props.agentId) return props.children;
  return <ChatDashboardOwner key={props.agentId} {...props} />;
}

function ChatDashboardOwner({ agentId, agentName, children }: ProviderProps) {
  const [content, setContent] = useState<Record<string, Content>>({});
  const visible = useRef(new Map<string, number>());
  const requests = useRef(new Map<string, Promise<void>>());
  const versions = useRef(new Map<string, number>());
  const active = useRef(true);

  const reload = useCallback(
    function refresh(key: string, force = false): Promise<void> {
      const pending = requests.current.get(key);
      if (pending) {
        if (!force) return pending;
        // A save/conflict needs a read that begins after it. An older poll may
        // have captured stale data even though its response is still in flight.
        versions.current.set(key, (versions.current.get(key) ?? 0) + 1);
        return pending.then(() => (active.current ? refresh(key) : undefined));
      }
      const version = versions.current.get(key) ?? 0;
      const request = (async () => {
        try {
          const result = await getChatDashboard({ data: { agentId, key } });
          if (!active.current || (versions.current.get(key) ?? 0) !== version)
            return;
          if (result.ok) {
            // Render only the reference requested, even if a future server sends
            // an incompatible response. Ordinary chat remains available.
            if (
              result.value.widgets.some(
                (widget) => widget.key !== key || widget.agentId !== agentId,
              )
            ) {
              setContent((current) => ({
                ...current,
                [key]: { error: "This tracker could not be loaded." },
              }));
              return;
            }
            setContent((current) => ({
              ...current,
              [key]: { snapshot: result.value },
            }));
          } else {
            setContent((current) => ({
              ...current,
              [key]: { error: result.error },
            }));
          }
        } catch {
          if (!active.current || (versions.current.get(key) ?? 0) !== version)
            return;
          setContent((current) => ({
            ...current,
            [key]: {
              ...current[key],
              error: "Could not refresh this tracker. Try again.",
            },
          }));
        }
      })();
      requests.current.set(key, request);
      void request.finally(() => {
        if (requests.current.get(key) === request) requests.current.delete(key);
      });
      return request;
    },
    [agentId],
  );
  const register = useCallback(
    (key: string) => {
      visible.current.set(key, (visible.current.get(key) ?? 0) + 1);
      void reload(key);
      return () => {
        const count = (visible.current.get(key) ?? 1) - 1;
        if (count > 0) visible.current.set(key, count);
        else visible.current.delete(key);
      };
    },
    [reload],
  );
  useEffect(() => {
    active.current = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      for (const key of visible.current.keys()) void reload(key);
    };
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);
  const change = useCallback(
    (widget: DashboardWidget) => {
      if (widget.agentId !== agentId) return;
      versions.current.set(
        widget.key,
        (versions.current.get(widget.key) ?? 0) + 1,
      );
      setContent((current) => {
        const snapshot = current[widget.key]?.snapshot;
        if (!snapshot) return current;
        return {
          ...current,
          [widget.key]: {
            snapshot: {
              ...snapshot,
              widgets: snapshot.widgets.map((existing) =>
                existing.key === widget.key &&
                existing.revision <= widget.revision
                  ? widget
                  : existing,
              ),
            },
          },
        };
      });
    },
    [agentId],
  );
  return (
    <Context
      value={{
        agentId,
        agentName,
        content,
        register,
        reload: (key) => reload(key, true),
        change,
      }}
    >
      <DashboardTrackerDrafts>{children}</DashboardTrackerDrafts>
    </Context>
  );
}

export function ChatDashboard({ widgetKey }: { widgetKey: string }) {
  const context = useContext(Context);
  const register = context?.register;
  useEffect(() => register?.(widgetKey), [register, widgetKey]);
  if (!context) return null;
  const { snapshot, error } = context.content[widgetKey] ?? {};
  const unavailable =
    snapshot && (!snapshot.enabled || !snapshot.widgets.length);
  return (
    <section aria-label="Shared tracker" {...stylex.props(styles.content)}>
      {error && (
        <p role="status" {...stylex.props(styles.notice)}>
          {error}
        </p>
      )}
      {!snapshot && !error && (
        <p role="status" {...stylex.props(styles.notice)}>
          Loading tracker…
        </p>
      )}
      {unavailable && (
        <p {...stylex.props(styles.notice)}>
          {snapshot.presentation.notice ??
            (snapshot.enabled
              ? "This tracker is no longer available."
              : "Dashboards are turned off.")}
        </p>
      )}
      {(error || unavailable) && (
        <Button onClick={() => void context.reload(widgetKey)}>
          Refresh tracker
        </Button>
      )}
      {snapshot?.enabled && snapshot.widgets.length > 0 && (
        <Suspense fallback={<p role="status">Loading tracker…</p>}>
          <DashboardPlanContent
            plan={snapshot.presentation.plan}
            widgets={snapshot.widgets}
            datasets={snapshot.datasets}
            agentName={context.agentName}
            onDiscuss={() => {}}
            onWidgetChange={context.change}
            onReload={() => context.reload(widgetKey)}
            inline
          />
        </Suspense>
      )}
    </section>
  );
}

const styles = stylex.create({
  content: { width: "100%", minWidth: 0, marginTop: 10, lineHeight: 1.5 },
  notice: { fontSize: 13, color: colors.muted, marginBlock: 8 },
});
