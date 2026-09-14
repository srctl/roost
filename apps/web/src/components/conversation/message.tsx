import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { FileAttachment } from "../../features/chat/files";
import { usePreferences } from "../../features/settings/preferences";
import { motion } from "../../styles/motion.stylex";
import { colors } from "../../styles/tokens.stylex";
import { FileLinks } from "./file-links";
import { MessageContent } from "./message-content";

export function UserMessage({
  children,
  files,
  entering = false,
  compact = false,
}: {
  children: ReactNode;
  files?: readonly FileAttachment[];
  /** Plays the send animation: the bubble rises from the composer into place. */
  entering?: boolean;
  compact?: boolean;
}) {
  const { responseStyle } = usePreferences();

  return (
    <div
      {...stylex.props(
        styles.userMessage,
        responseStyle === "messages" && styles.outgoing,
        compact && styles.compactUser,
        compact && responseStyle !== "messages" && styles.compactIndent,
        entering && styles.sent,
      )}
    >
      {children}
      <FileLinks files={files} />
    </div>
  );
}

export function AgentMessage({
  name,
  action,
  title,
  files,
  children,
  entering = false,
  compact = false,
}: {
  name: string;
  action?: ReactNode;
  title?: string;
  files?: readonly FileAttachment[];
  children: string;
  /** Fades the reply in when it first arrives during this visit. */
  entering?: boolean;
  compact?: boolean;
}) {
  const { responseStyle } = usePreferences();

  const article = (
    <article
      aria-label={`${name} response`}
      {...stylex.props(
        styles.message,
        responseStyle === "messages" && styles.incoming,
        compact && styles.compactAgent,
        !!action && styles.actionArticle,
        entering && !action && styles.received,
      )}
    >
      {title && <div {...stylex.props(styles.automation)}>{title}</div>}
      {children && <MessageContent>{children}</MessageContent>}
      <FileLinks files={files} />
    </article>
  );

  return action ? (
    <div
      {...stylex.props(
        styles.actionGroup,
        responseStyle === "messages" && styles.bubbleActionGroup,
        compact && styles.compactAgent,
        stylex.defaultMarker(),
        entering && styles.received,
      )}
    >
      {article}
      {action}
    </div>
  ) : (
    article
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(18px) scale(0.97)" },
  to: { opacity: 1, transform: "translateY(0) scale(1)" },
});

const fadeUp = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(8px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

const styles = stylex.create({
  automation: { fontSize: 11, color: colors.muted, marginBottom: 6 },
  userMessage: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    marginLeft: { default: 64, "@media (max-width: 1100px)": 24 },
    backgroundColor: colors.bubble,
    borderRadius: 14,
    paddingBlock: 10,
    paddingInline: 14,
    marginTop: 16,
    marginBottom: 23,
    fontSize: 13,
    lineHeight: 1.65,
  },
  message: { marginTop: 20, overflowWrap: "anywhere", lineHeight: 1.75 },
  // Reserve exterior space for the target and focus ring; the group also keeps
  // hover active while the pointer crosses from message to control.
  actionGroup: {
    display: "flex",
    alignItems: "flex-end",
    width: "fit-content",
    maxWidth: "100%",
    minHeight: 48,
    columnGap: 4,
    paddingInlineEnd: 4,
    marginTop: 20,
  },
  bubbleActionGroup: {
    maxWidth: "min(100%, calc(88% + 48px))",
    marginTop: 8,
  },
  actionArticle: { minWidth: 0, maxWidth: "none", marginTop: 0 },
  incoming: {
    width: "fit-content",
    maxWidth: "88%",
    marginTop: 8,
    paddingBlock: 10,
    paddingInline: 14,
    backgroundColor: colors.bubble,
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    lineHeight: 1.6,
  },
  outgoing: {
    width: "fit-content",
    maxWidth: "88%",
    marginLeft: "auto",
    marginBottom: 16,
    borderRadius: 18,
    borderBottomRightRadius: 5,
    backgroundColor: colors.action,
    color: colors.onAccent,
  },
  compactUser: {
    marginTop: 8,
    marginBottom: 12,
    paddingBlock: 8,
    paddingInline: 12,
  },
  compactIndent: { marginLeft: 24 },
  compactAgent: { marginTop: 8 },
  sent: {
    transformOrigin: "bottom right",
    animationName: rise,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeOut,
    animationFillMode: "backwards",
  },
  received: {
    transformOrigin: "bottom left",
    animationName: fadeUp,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeOut,
    animationFillMode: "backwards",
  },
});
