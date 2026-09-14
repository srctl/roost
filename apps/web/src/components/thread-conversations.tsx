import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { Agent } from "../features/agents/schema";
import {
  getConversation,
  type InitialConversation,
} from "../features/chat/functions";
import { colors } from "../styles/tokens.stylex";
import { Conversation } from "./conversation";
import { Button } from "./ui/button";

export function ThreadConversations({
  agent,
  initialConversation,
}: {
  agent: Agent;
  initialConversation?: InitialConversation;
}) {
  const [id, setId] = useState<string>();
  const [loaded, setSnapshot] = useState<{
    id: string;
    result: InitialConversation;
  }>();
  const snapshot = loaded && loaded.id === id ? loaded.result : undefined;
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const read = () => {
      const next = new URLSearchParams(location.search).get("conversation");
      setId(next && next !== agent.id ? next : undefined);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [agent.id]);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setSnapshot(undefined);
    void getConversation({ data: { agentId: agent.id, conversationId: id } })
      .then((result) => {
        if (!cancelled) setSnapshot({ id, result });
      })
      .catch(() => {
        if (!cancelled)
          setSnapshot({
            id,
            result: {
              ok: false,
              error: "Could not open this thread. It may have been deleted.",
            },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [id, agent.id]);
  useEffect(() => {
    if (!id) return;
    const element = panel.current;
    if (!element) return;
    const query = matchMedia("(max-width: 700px)");
    const changed = new Map<HTMLElement, boolean>();
    const update = () => {
      for (const [node, value] of changed) node.inert = value;
      changed.clear();
      if (!query.matches) return;
      let current: HTMLElement = element;
      while (current.parentElement) {
        for (const sibling of current.parentElement.children) {
          if (sibling !== current && sibling instanceof HTMLElement) {
            changed.set(sibling, sibling.inert);
            sibling.inert = true;
          }
        }
        current = current.parentElement;
      }
    };
    update();
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
      for (const [node, value] of changed) node.inert = value;
    };
  }, [id]);
  useEffect(() => {
    if (id) panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else opener.current?.focus();
  }, [snapshot, id]);
  function open(next: string) {
    opener.current = document.activeElement as HTMLElement;
    history.pushState(
      null,
      "",
      `/agents/${agent.id}?conversation=${encodeURIComponent(next)}`,
    );
    setId(next);
  }
  function close() {
    history.pushState(null, "", `/agents/${agent.id}`);
    setId(undefined);
  }
  const parent = snapshot?.ok
    ? snapshot.value.threads.find((t) => t.id === id)?.parent
    : undefined;
  return (
    <div {...stylex.props(styles.layout)}>
      <div {...stylex.props(styles.main, !!id && styles.mainWithThread)}>
        <Conversation
          agent={agent}
          initialConversation={initialConversation}
          onOpenThread={open}
        />
      </div>
      {id && (
        <section
          ref={panel}
          aria-label="Reply thread"
          {...stylex.props(styles.panel)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
            if (
              event.key === "Tab" &&
              matchMedia("(max-width: 700px)").matches
            ) {
              const items = panel.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled), textarea, input, a[href]",
              );
              if (items?.length) {
                const first = items[0]!,
                  last = items[items.length - 1]!;
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }
          }}
        >
          {snapshot?.ok && (parent || snapshot.value.job) ? (
            <Conversation
              key={id}
              agent={agent}
              conversationId={id}
              title={snapshot?.ok ? snapshot.value.job?.title : undefined}
              initialConversation={snapshot}
              parent={parent}
              embedded
              onClose={close}
            />
          ) : (
            <>
              <Button onClick={close}>Close thread</Button>
              <p role={snapshot && !snapshot.ok ? "alert" : "status"}>
                {snapshot && !snapshot.ok ? snapshot.error : "Loading thread…"}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
const styles = stylex.create({
  layout: {
    display: "flex",
    gap: 24,
    width: "100%",
    minWidth: 0,
    height: "100%",
  },
  main: { flex: 1, minWidth: 0 },
  mainWithThread: {
    visibility: { default: "visible", "@media (max-width: 700px)": "hidden" },
  },
  panel: {
    flex: 1,
    minWidth: 0,
    maxWidth: 540,
    borderLeft: `1px solid ${colors.border}`,
    paddingLeft: 20,
    backgroundColor: colors.background,
    height: "calc(100svh - 40px)",
    "@media (max-width: 700px)": {
      position: "fixed",
      inset: 0,
      maxWidth: "none",
      padding: 12,
      height: "100svh",
      zIndex: 40,
      borderLeft: 0,
    },
  },
});
