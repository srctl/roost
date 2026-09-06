import { ComputerPanel } from "./computer-panel";
import { getComputerStatus } from "../features/computer/functions";
import { computerPreviewAnchor } from "../features/computer/preview";
import { Fragment, useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { AgentMessage, UserMessage } from "./conversation/message";
import { TypingIndicator } from "./conversation/typing-indicator";
import { ScrollArea } from "./ui/scroll-area";
import { ToolActivity } from "./conversation/tool-activity";
import { ConversationNotice } from "./conversation/notice";
import { MobileNavigation } from "./mobile-navigation";
import { Composer } from "./conversation/composer";
import { Button } from "./ui/button";
import { Avatar, Icon } from "./ui/primitives";
import { AgentSettings } from "./agent-settings";
import { colors } from "../styles/tokens.stylex";
import type { Agent } from "../features/agents/schema";
import type { Message } from "../features/chat/schema";
import { useConversation } from "../features/chat/use-conversation";
import { usePreferences } from "../features/settings/preferences";

export function Conversation({
  agent,
  messages: initialMessages,
}: {
  agent: Agent;
  messages: readonly Message[];
}) {
  const { messages, busy, runId, error, send, stop, reload } = useConversation(
    agent.id,
    initialMessages,
  );
  const [computerEnabled, setComputerEnabled] = useState(false);
  const [manualComputerOpen, setManualComputerOpen] = useState(false);
  const [dismissedComputerRun, setDismissedComputerRun] = useState<
    string | null
  >(null);
  const computerAnchor = computerPreviewAnchor(messages, runId);
  const computerOpen =
    !manualComputerOpen && !!(computerAnchor && dismissedComputerRun !== runId);
  useEffect(() => {
    let current = true;
    void getComputerStatus()
      .then((status) => {
        if (current) setComputerEnabled(status.enabled);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  const viewport = useRef<HTMLDivElement>(null);
  const { responseStyle, showActivityDetails } = usePreferences();
  const followReply = useRef(true);
  const liveStatus =
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "activity" && message.status === "inProgress",
      )?.title ??
    (messages.at(-1)?.role === "assistant" ? "Replying" : "Thinking");
  useEffect(() => {
    if (viewport.current && followReply.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [
    messages,
    busy,
    responseStyle,
    showActivityDetails,
    computerOpen,
    computerEnabled,
  ]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (followReply.current) element.scrollTop = element.scrollHeight;
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <section
      {...stylex.props(styles.conversation)}
      aria-label={`Conversation with ${agent.name}`}
    >
      <header {...stylex.props(styles.header)}>
        <MobileNavigation />
        <Avatar character={agent.character} />
        <h1 {...stylex.props(styles.title)}>{agent.name}</h1>
        <div {...stylex.props(styles.settings)}>
          {computerEnabled && (
            <Button
              aria-label="Open computer"
              aria-haspopup="dialog"
              onClick={() => setManualComputerOpen(true)}
            >
              <Icon name="monitor" />
            </Button>
          )}
          <AgentSettings agent={agent} />
        </div>
      </header>
      <ScrollArea
        label="Conversation history"
        viewportRef={viewport}
        onScroll={(event) => {
          const element = event.currentTarget;
          followReply.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            64;
        }}
      >
        <div {...stylex.props(styles.history)}>
          {!messages.length && (
            <div {...stylex.props(styles.empty)}>
              <h2>Say hello to {agent.name}.</h2>
              <p>
                Ask a question, share an idea, or tell your agent what you need.
              </p>
            </div>
          )}
          {messages.map((message) => (
            <Fragment key={message.id}>
              {message.role === "user" ? (
                <UserMessage>{message.text}</UserMessage>
              ) : message.role === "notice" ? (
                <ConversationNotice agentId={agent.id} message={message} />
              ) : message.role === "activity" ? (
                <ToolActivity message={message} />
              ) : (
                <AgentMessage name={agent.name} title={message.title}>
                  {message.text}
                </AgentMessage>
              )}
              {computerEnabled &&
                computerOpen &&
                message.id === computerAnchor && (
                  <ComputerPanel
                    agentName={agent.name}
                    onClose={() => setDismissedComputerRun(runId)}
                  />
                )}
            </Fragment>
          ))}
          {busy && responseStyle === "messages" && (
            <TypingIndicator name={agent.name} />
          )}
        </div>
      </ScrollArea>
      {computerEnabled && manualComputerOpen && (
        <ComputerPanel
          agentName={agent.name}
          fullScreen
          onClose={() => setManualComputerOpen(false)}
        />
      )}
      {error && (
        <div role="alert" {...stylex.props(styles.error)}>
          {error}
          <Button disabled={busy} onClick={() => void reload()}>
            Reload conversation
          </Button>
        </div>
      )}
      <Composer
        agentName={agent.name}
        busy={busy}
        status={busy ? liveStatus : undefined}
        onSend={(text) => {
          followReply.current = true;
          return send(text);
        }}
        onStop={stop}
      />
    </section>
  );
}
const styles = stylex.create({
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
  header: {
    display: "flex",
    alignItems: "center",
    gap: { default: 10, "@media (max-width: 700px)": 6 },
    flexShrink: 0,
    minHeight: {
      default: 0,
      "@media (max-width: 700px)": "calc(56px + env(safe-area-inset-top))",
    },
    paddingTop: {
      default: 0,
      "@media (max-width: 700px)": "env(safe-area-inset-top)",
    },
    paddingInline: { default: 0, "@media (max-width: 700px)": 8 },
    paddingBottom: { default: 12, "@media (max-width: 700px)": 0 },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 16,
    fontWeight: 500,
    margin: 0,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  settings: { marginLeft: "auto", display: "flex", gap: 4 },
  history: {
    flex: 1,
    minHeight: 0,
    paddingBlock: { default: 24, "@media (max-width: 700px)": 16 },
    paddingLeft: { default: 0, "@media (max-width: 700px)": 12 },
  },
  empty: { paddingTop: 60, color: colors.muted, textAlign: "center" },
  error: { color: colors.review, fontSize: 12, paddingBlock: 8 },
});
