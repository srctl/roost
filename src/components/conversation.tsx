import * as stylex from "@stylexjs/stylex";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgentActivity } from "../features/agents/activity";
import type { Agent } from "../features/agents/schema";
import {
  type InitialConversation,
  openThread,
} from "../features/chat/functions";
import { useConversation } from "../features/chat/use-conversation";
import { computerPreviewAnchor } from "../features/computer/preview";
import { useLiveEntries, useMountedAfterLoad } from "../features/motion";
import { usePreferences } from "../features/settings/preferences";
import { Route as RootRoute } from "../routes/__root";
import { motion } from "../styles/motion.stylex";
import { colors } from "../styles/tokens.stylex";
import { AgentHeader } from "./agent-header";
import { ApprovalRequests } from "./approval-requests";
import { Composer } from "./conversation/composer";
import { AgentMessage, UserMessage } from "./conversation/message";
import { ConversationNotice } from "./conversation/notice";
import { ToolActivity } from "./conversation/tool-activity";
import { TypingIndicator } from "./conversation/typing-indicator";
import { Appear } from "./ui/appear";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";
import { ScrollArea } from "./ui/scroll-area";

const ComputerPanel = lazy(() =>
  import("./computer-panel").then((module) => ({
    default: module.ComputerPanel,
  })),
);

/** How long a programmatic smooth scroll may keep the viewport pinned. */
const SETTLE_MS = 700;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollToEnd(element: HTMLElement, smooth: boolean) {
  if (smooth)
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  else element.scrollTop = element.scrollHeight;
}

export function Conversation({
  agent,
  initialConversation,
  embedded = false,
  onClose,
  conversationId = agent.id,
  parent: initialParent,
  onOpenThread,
}: {
  agent: Agent;
  initialConversation?: InitialConversation;
  embedded?: boolean;
  onClose?: () => void;
  conversationId?: string;
  parent?: import("../features/chat/schema").Message;
  onOpenThread?: (id: string) => void;
}) {
  const waitingForApproval = useAgentActivity()[agent.id] === "approval";
  const {
    messages,
    threads,
    runStatus,
    active,
    computerAnchor: savedComputerAnchor,
    busy,
    runId,
    error,
    send,
    stop,
    reload,
    loading,
    loadingOlder,
    before,
    loadOlder,
  } = useConversation(agent.id, initialConversation, conversationId);
  const parent =
    threads.find((thread) => thread.id === conversationId)?.parent ??
    initialParent;
  const [threadError, setThreadError] = useState<string>();
  const [seen, setSeen] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      setSeen(
        JSON.parse(localStorage.getItem(`roost:seen:${agent.id}`) ?? "{}"),
      );
    } catch {}
  }, [agent.id]);
  useEffect(() => {
    if (
      conversationId === agent.id ||
      loading ||
      document.visibilityState !== "visible"
    )
      return;
    const activity =
      threads.find((t) => t.id === conversationId)?.activity ?? 0;
    try {
      const current = JSON.parse(
        localStorage.getItem(`roost:seen:${agent.id}`) ?? "{}",
      );
      current[conversationId] = activity;
      localStorage.setItem(`roost:seen:${agent.id}`, JSON.stringify(current));
      window.dispatchEvent(new Event("roost-thread-read"));
    } catch {}
  }, [threads, conversationId, agent.id, loading]);
  useEffect(() => {
    const update = () => {
      try {
        setSeen(
          JSON.parse(localStorage.getItem(`roost:seen:${agent.id}`) ?? "{}"),
        );
      } catch {}
    };
    window.addEventListener("storage", update);
    window.addEventListener("roost-thread-read", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("roost-thread-read", update);
    };
  }, [agent.id]);
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), 500);
    return () => clearTimeout(timer);
  }, [loading]);
  // Switching agents fades the new history in; the first page load stays still.
  const live = useMountedAfterLoad();
  const ids = useMemo(() => messages.map((message) => message.id), [messages]);
  const entering = useLiveEntries(ids, !loading);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const { computerEnabled } = RootRoute.useLoaderData();
  const [manualComputerOpen, setManualComputerOpen] = useState(false);
  const [dismissedComputerRun, setDismissedComputerRun] = useState<
    string | null
  >(null);
  const computerAnchor =
    computerPreviewAnchor(messages, runId) ?? savedComputerAnchor;
  const computerOpen =
    !manualComputerOpen && !!(computerAnchor && dismissedComputerRun !== runId);
  const viewport = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const [showBottomButton, setShowBottomButton] = useState(false);
  const updateBottomButton = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    // Half a visible page, but never inside the existing 64px follow boundary.
    setShowBottomButton(distance > Math.max(64, element.clientHeight / 2));
  }, []);
  const { responseStyle, showActivityDetails } = usePreferences();
  const followReply = useRef(true);
  const restoredScroll = useRef(false);
  const resolvedAnchor = useRef<string | undefined>(undefined);
  const [locationKey, setLocationKey] = useState("");
  useEffect(() => {
    const update = () => setLocationKey(location.search + location.hash);
    update();
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  useEffect(() => {
    const selected =
      new URLSearchParams(location.search).get("conversation") || agent.id;
    const key = selected + location.hash;
    if (
      loading ||
      !location.hash ||
      selected !== conversationId ||
      resolvedAnchor.current === key
    )
      return;
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      resolvedAnchor.current = key;
      return;
    }
    const target = viewport.current?.querySelector(`[id="${CSS.escape(id)}"]`);
    followReply.current = false;
    if (target) {
      target.scrollIntoView({ block: "center" });
      resolvedAnchor.current = key;
    } else if (before !== null && !loadingOlder) void loadOlder();
    else if (before === null) resolvedAnchor.current = key;
  }, [
    messages,
    loading,
    before,
    loadingOlder,
    loadOlder,
    conversationId,
    agent.id,
    locationKey,
  ]);
  const restoreTarget = useRef<
    { top: number; anchor?: string; offset?: number } | null | undefined
  >(undefined);
  useLayoutEffect(() => {
    if (loading || restoredScroll.current || !viewport.current) return;
    const selected =
      new URLSearchParams(location.search).get("conversation") || agent.id;
    if (selected === conversationId && location.hash) {
      restoredScroll.current = true;
      followReply.current = false;
      return;
    }
    if (restoreTarget.current === undefined) {
      try {
        const raw = JSON.parse(
          sessionStorage.getItem(`roost:scroll:${conversationId}`) ?? "null",
        );
        restoreTarget.current = typeof raw === "number" ? { top: raw } : raw;
      } catch {
        restoreTarget.current = null;
      }
    }
    const saved = restoreTarget.current;
    if (!saved) {
      restoredScroll.current = true;
      return;
    }
    followReply.current = false;
    const element = viewport.current;
    const anchor = saved.anchor
      ? element.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(saved.anchor)}"]`,
        )
      : null;
    if (saved.anchor && !anchor && before !== null) {
      if (!loadingOlder) void loadOlder();
      return;
    }
    restoredScroll.current = true;
    element.scrollTop = anchor
      ? element.scrollTop +
        anchor.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        (saved.offset ?? 0)
      : saved.top;
  }, [
    loading,
    conversationId,
    messages,
    before,
    loadingOlder,
    loadOlder,
    agent.id,
  ]);
  // Sending scrolls smoothly so the new bubble glides up from the composer.
  // Streaming updates keep jumping instantly; a smooth scroll every poll would
  // fight the reader. While a smooth scroll settles, scroll events are ours.
  const smoothNext = useRef(false);
  const settleUntil = useRef(0);
  const liveStatus =
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "activity" && message.status === "inProgress",
      )?.title ??
    (messages.at(-1)?.role === "assistant" ? "Replying" : "Thinking");
  useLayoutEffect(() => {
    if (!loadingOlder && prepend.current && viewport.current) {
      viewport.current.scrollTop =
        prepend.current.top +
        viewport.current.scrollHeight -
        prepend.current.height;
      prepend.current = null;
    }
  }, [messages, loadingOlder]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (!followReply.current) {
      updateBottomButton();
      return;
    }
    const smooth =
      (smoothNext.current || settleUntil.current > Date.now()) &&
      !prefersReducedMotion();
    smoothNext.current = false;
    if (smooth) settleUntil.current = Date.now() + SETTLE_MS;
    scrollToEnd(element, smooth);
    updateBottomButton();
  }, [
    messages,
    savedComputerAnchor,
    busy,
    responseStyle,
    showActivityDetails,
    computerOpen,
    computerEnabled,
    updateBottomButton,
  ]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (followReply.current)
          scrollToEnd(
            element,
            settleUntil.current > Date.now() && !prefersReducedMotion(),
          );
        updateBottomButton();
      });
    });
    observer.observe(element);
    if (history.current) observer.observe(history.current);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [updateBottomButton]);

  function replyLabel(messageId: string) {
    const thread = threads.find((t) => t.parentMessageId === messageId);
    return thread
      ? `${thread.replyCount} ${thread.replyCount === 1 ? "reply" : "replies"}${thread.activity > (seen[thread.id] ?? 0) ? " · Unread" : ""}${thread.status ? ` · ${thread.status}` : ""}`
      : "Reply in thread";
  }

  return (
    <section
      {...stylex.props(styles.conversation, embedded && styles.embedded)}
      aria-label={
        parent ? `Thread with ${agent.name}` : `Conversation with ${agent.name}`
      }
    >
      {embedded ? (
        <header {...stylex.props(styles.chatHeader)}>
          <h2 {...stylex.props(styles.chatTitle)}>
            {parent ? "Thread" : "Conversation"}
          </h2>
          <Button
            onClick={onClose}
            aria-label={parent ? "Close thread" : "Close chat"}
            xstyle={parent ? undefined : styles.closeChat}
          >
            <Icon name="close" />
          </Button>
        </header>
      ) : (
        <AgentHeader agent={agent}>
          {computerEnabled && (
            <Button
              aria-label="Open computer"
              aria-haspopup="dialog"
              onClick={() => setManualComputerOpen(true)}
            >
              <Icon name="monitor" />
            </Button>
          )}
        </AgentHeader>
      )}
      <div {...stylex.props(styles.historyArea)}>
        <ScrollArea
          label="Conversation history"
          viewportRef={viewport}
          onScroll={(event) => {
            const element = event.currentTarget;
            if (restoredScroll.current) {
              const top = element.getBoundingClientRect().top;
              const anchor = [
                ...element.querySelectorAll<HTMLElement>("[data-message-id]"),
              ].find((node) => node.getBoundingClientRect().bottom > top);
              sessionStorage.setItem(
                `roost:scroll:${conversationId}`,
                JSON.stringify({
                  top: element.scrollTop,
                  anchor: anchor?.dataset.messageId,
                  offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
                }),
              );
            }
            const distance =
              element.scrollHeight - element.scrollTop - element.clientHeight;
            updateBottomButton();
            if (settleUntil.current > Date.now()) {
              if (distance < 2) settleUntil.current = 0;
              return;
            }
            followReply.current = distance < 64;
          }}
        >
          <div
            ref={history}
            {...stylex.props(
              styles.history,
              parent && styles.threadHistory,
              live && styles.enter,
            )}
          >
            {parent && (
              <div {...stylex.props(styles.parent)}>
                <p {...stylex.props(styles.parentAuthor)}>
                  {parent.role === "user" ? "You" : agent.name}
                </p>
                {parent.role === "user" ? (
                  <UserMessage compact files={parent.files}>
                    {parent.text}
                  </UserMessage>
                ) : (
                  <AgentMessage compact name={agent.name} files={parent.files}>
                    {parent.text}
                  </AgentMessage>
                )}
              </div>
            )}
            {loading && showLoading && (
              <p role="status">Loading conversation… You can start typing.</p>
            )}
            {before !== null && (
              <Button
                disabled={loadingOlder}
                onClick={() => {
                  if (viewport.current)
                    prepend.current = {
                      height: viewport.current.scrollHeight,
                      top: viewport.current.scrollTop,
                    };
                  followReply.current = false;
                  void loadOlder();
                }}
              >
                {loadingOlder
                  ? "Loading older messages…"
                  : "Load older messages"}
              </Button>
            )}
            {!loading && !messages.length && (
              <div {...stylex.props(styles.empty)}>
                <h2>
                  {parent ? "No replies yet" : `Say hello to ${agent.name}.`}
                </h2>
                <p>
                  {parent
                    ? "Reply to this message to continue the discussion."
                    : "Ask a question, share an idea, or tell your agent what you need."}
                </p>
              </div>
            )}
            {threadError && <p role="alert">{threadError}</p>}
            {messages.map((message) => (
              <div
                key={message.id}
                id={message.id}
                data-message-id={message.id}
              >
                {message.role === "user" ? (
                  <UserMessage
                    files={message.files}
                    compact={!!parent}
                    entering={entering.has(message.id)}
                  >
                    {message.text}
                  </UserMessage>
                ) : message.role === "notice" ? (
                  <ConversationNotice agentId={agent.id} message={message} />
                ) : message.role === "activity" ? (
                  <ToolActivity
                    conversationId={conversationId}
                    agentId={agent.id}
                    message={message}
                    entering={entering.has(message.id)}
                  />
                ) : (
                  <AgentMessage
                    name={agent.name}
                    title={message.title}
                    files={message.files}
                    compact={!!parent}
                    entering={entering.has(message.id)}
                  >
                    {message.text}
                  </AgentMessage>
                )}
                {onOpenThread &&
                  (message.role === "user" || message.role === "assistant") && (
                    <Button
                      aria-label={`Reply in thread: ${message.text.slice(0, 60)}. ${replyLabel(message.id)}`}
                      onClick={async () => {
                        const existing = threads.find(
                          (thread) => thread.parentMessageId === message.id,
                        );
                        if (existing) {
                          setThreadError(undefined);
                          onOpenThread(existing.id);
                          return;
                        }
                        try {
                          const result = await openThread({
                            data: {
                              agentId: agent.id,
                              parentMessageId: message.id,
                            },
                          });
                          if (result.ok) {
                            setThreadError(undefined);
                            onOpenThread(result.value.id);
                          } else setThreadError(result.error);
                        } catch {
                          setThreadError(
                            "Could not open this thread. Please retry.",
                          );
                        }
                      }}
                    >
                      {replyLabel(message.id)}
                    </Button>
                  )}
                {computerEnabled &&
                  computerOpen &&
                  message.id === computerAnchor && (
                    <Suspense fallback={<p role="status">Loading desktop…</p>}>
                      <ComputerPanel
                        agentName={agent.name}
                        onClose={() => setDismissedComputerRun(runId)}
                      />
                    </Suspense>
                  )}
              </div>
            ))}
            {computerEnabled &&
              computerOpen &&
              !messages.some((message) => message.id === computerAnchor) && (
                <Suspense fallback={<p role="status">Loading desktop…</p>}>
                  <ComputerPanel
                    agentName={agent.name}
                    onClose={() => setDismissedComputerRun(runId)}
                  />
                </Suspense>
              )}
            {busy &&
              runStatus !== "queued" &&
              !waitingForApproval &&
              responseStyle === "messages" && (
                <TypingIndicator name={agent.name} />
              )}
          </div>
        </ScrollArea>
        {showBottomButton && (
          <Button
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
            xstyle={styles.bottomButton}
            onClick={() => {
              const element = viewport.current;
              if (!element) return;
              followReply.current = true;
              smoothNext.current = false;
              settleUntil.current = 0;
              // An immediate jump also respects reduced motion and cannot fight
              // the next manual scroll while a long animation settles.
              scrollToEnd(element, false);
              updateBottomButton();
              element.focus({ preventScroll: true });
            }}
          >
            <Icon name="arrow-down" size={20} />
          </Button>
        )}
      </div>
      {computerEnabled && manualComputerOpen && (
        <Suspense fallback={<p role="status">Loading desktop…</p>}>
          <ComputerPanel
            agentName={agent.name}
            fullScreen
            onClose={() => setManualComputerOpen(false)}
          />
        </Suspense>
      )}
      {error && (
        <Appear role="alert" xstyle={styles.error}>
          {error}
          <Button disabled={busy} onClick={() => void reload()}>
            Reload conversation
          </Button>
        </Appear>
      )}
      {active && active.conversationId !== conversationId && (
        <p role="status">
          Agent is working in another conversation. New messages will queue.
        </p>
      )}
      {runStatus === "queued" && (
        <p role="status">
          Queued — waiting for the agent’s active conversation.
        </p>
      )}
      <ApprovalRequests
        agentId={agent.id}
        busy={busy}
        runId={runId ?? undefined}
      />
      <Composer
        compact={!!parent}
        agentId={agent.id}
        agentName={agent.name}
        conversationId={conversationId}
        busy={busy}
        loading={loading}
        status={
          busy
            ? runStatus === "queued"
              ? "Queued"
              : waitingForApproval
                ? "Waiting for you"
                : liveStatus
            : undefined
        }
        onSend={(text, files) => {
          followReply.current = true;
          smoothNext.current = true;

          return send(text, files);
        }}
        onStop={stop}
      />
      {/* Run after the composer fixes the history viewport height, before the
          server markup is painted. React follows subsequent message updates. */}
      <script>{`{const v=document.currentScript?.parentElement?.querySelector('[aria-label="Conversation history"]');if(v)v.scrollTop=v.scrollHeight;}`}</script>
    </section>
  );
}

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const styles = stylex.create({
  parent: {
    borderBottom: `1px solid ${colors.border}`,
    paddingBottom: 12,
    marginBottom: 12,
    overflowWrap: "anywhere",
  },
  parentAuthor: { margin: 0, color: colors.muted, fontWeight: 500 },
  threadHistory: { paddingBlock: 8, paddingLeft: 0 },
  conversation: {
    display: "flex",
    flexDirection: "column",
    maxWidth: 760,
    width: "100%",
    marginInline: "auto",
    height: {
      default: "calc(100svh - 40px)",
      "@media (max-width: 700px)": "100%",
    },
    minHeight: { default: 420, "@media (max-width: 700px)": 0 },
  },
  embedded: {
    height: "100%",
    minHeight: 0,
    maxWidth: "none",
  },
  chatHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    flexShrink: 0,
  },
  chatTitle: { margin: 0, fontSize: 13, fontWeight: 500 },
  closeChat: {
    display: { default: "none", "@media (max-width: 1100px)": "inline-flex" },
  },
  historyArea: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
  },
  bottomButton: {
    position: "absolute",
    bottom: 12,
    insetInlineStart: "calc(50% - 22px)",
    width: 44,
    height: 44,
    minHeight: 44,
    padding: 0,
    borderRadius: "50%",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.surface} 88%, transparent)`,
      ":hover": colors.selected,
    },
    color: colors.foreground,
    outline: {
      default: null,
      ":focus-visible": `2px solid ${colors.foreground}`,
    },
    backdropFilter: "blur(12px)",
    boxShadow: "0 2px 8px rgb(0 0 0 / 12%)",
  },
  history: {
    flex: 1,
    minHeight: 0,
    paddingBlock: { default: 24, "@media (max-width: 700px)": 16 },
    paddingLeft: { default: 0, "@media (max-width: 700px)": 12 },
  },
  enter: {
    animationName: fadeIn,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut,
    animationFillMode: "backwards",
  },
  empty: { paddingTop: 60, color: colors.muted, textAlign: "center" },
  error: {
    display: "block",
    color: colors.review,
    fontSize: 12,
    paddingBlock: 8,
  },
});
