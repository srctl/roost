import type { ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";
import { usePreferences } from "../../features/settings/preferences";
import { MessageContent } from "./message-content";

export function UserMessage({ children }: { children: ReactNode }) {
  const { responseStyle } = usePreferences();

  return (
    <div
      {...stylex.props(
        styles.userMessage,
        responseStyle === "messages" && styles.outgoing,
      )}
    >
      {children}
    </div>
  );
}

export function AgentMessage({
  name,
  title,
  children,
}: {
  name: string;
  title?: string;
  children: string;
}) {
  const { responseStyle } = usePreferences();

  return (
    <article
      aria-label={`${name} response`}
      {...stylex.props(
        styles.message,
        responseStyle === "messages" && styles.incoming,
      )}
    >
      {title && <div {...stylex.props(styles.automation)}>{title}</div>}
      <MessageContent>{children}</MessageContent>
    </article>
  );
}

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
});
