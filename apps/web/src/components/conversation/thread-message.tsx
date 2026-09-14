import * as stylex from "@stylexjs/stylex";
import type { Agent } from "../../features/agents/schema";
import type { Message } from "../../features/chat/schema";
import { motion } from "../../styles/motion.stylex";
import { colors } from "../../styles/tokens.stylex";
import { Avatar } from "../ui/primitives";
import { FileLinks } from "./file-links";
import { MessageContent } from "./message-content";

export function ThreadMessage({
  agent,
  message,
  previous,
  entering = false,
}: {
  agent: Agent;
  message: Message;
  previous?: Message;
  entering?: boolean;
}) {
  const user = message.role === "user";
  const name = user ? "You" : agent.name;
  const date = message.createdAt ? new Date(message.createdAt) : undefined;
  const validDate = date && Number.isFinite(date.getTime()) ? date : undefined;
  // Group only adjacent replies with known times, never across tools or notices.
  const grouped =
    previous?.role === message.role &&
    !!previous.createdAt &&
    !!message.createdAt &&
    message.createdAt >= previous.createdAt &&
    message.createdAt - previous.createdAt < 5 * 60 * 1000;

  return (
    <article
      aria-label={`${name} ${user ? "message" : "response"}`}
      {...stylex.props(
        styles.row,
        grouped && styles.grouped,
        entering && styles.enter,
      )}
    >
      <div aria-hidden="true" {...stylex.props(styles.avatar)}>
        {user ? (
          <span {...stylex.props(styles.userAvatar)}>
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="8" r="3" />
              <path d="M5 21v-3a7 7 0 0 1 14 0v3" />
            </svg>
          </span>
        ) : (
          <Avatar character={agent.character} size={32} />
        )}
      </div>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.author)}>{name}</span>
          {validDate && (
            <time
              dateTime={validDate.toISOString()}
              title={validDate.toLocaleString()}
              {...stylex.props(styles.time)}
            >
              {validDate.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          )}
        </div>
        {message.title && (
          <div {...stylex.props(styles.title)}>{message.title}</div>
        )}
        {user ? (
          <div {...stylex.props(styles.text)}>{message.text}</div>
        ) : message.text ? (
          <div>
            <MessageContent>{message.text}</MessageContent>
          </div>
        ) : null}
        <FileLinks files={message.files} />
      </div>
    </article>
  );
}

const fade = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const styles = stylex.create({
  row: {
    display: "flex",
    gap: 10,
    marginTop: 12,
    fontSize: 13,
    lineHeight: 1.6,
    overflowWrap: "anywhere",
  },
  grouped: { marginTop: 4 },
  avatar: { width: 32, flexShrink: 0, paddingTop: 2 },
  userAvatar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: colors.bubble,
    color: colors.muted,
  },
  body: { flex: 1, minWidth: 0 },
  meta: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: 8,
  },
  author: { fontWeight: 600 },
  time: { fontSize: 11, color: colors.muted, whiteSpace: "nowrap" },
  title: { fontSize: 11, color: colors.muted, marginBottom: 4 },
  text: { whiteSpace: "pre-wrap" },
  enter: {
    animationName: fade,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut,
    animationFillMode: "backwards",
  },
});
