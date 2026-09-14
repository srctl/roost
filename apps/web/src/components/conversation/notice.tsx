import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { CODEX_SIGN_IN_REQUIRED } from "../../features/auth/schema";
import type { Message } from "../../features/chat/schema";
import { colors } from "../../styles/tokens.stylex";
import { Button } from "../ui/button";

const NoticeDetails = lazy(() =>
  import("./notice-details").then((module) => ({
    default: module.NoticeDetails,
  })),
);

export function ConversationNotice({
  agentId,
  message,
}: {
  agentId: string;
  message: Message;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div {...stylex.props(styles.notice)}>
      <div>
        <span>{message.title}</span>
        {message.text && (
          <span {...stylex.props(styles.reason)}> · {message.text}</span>
        )}
      </div>
      {message.text === CODEX_SIGN_IN_REQUIRED && (
        <Link
          to="/settings"
          search={{ group: "account" }}
          {...stylex.props(styles.link)}
        >
          Connect Codex
        </Link>
      )}
      {message.noticeKind === "delegation" && message.referenceId && (
        <Link
          to="/agents/$agentId"
          params={{ agentId: message.referenceId }}
          {...stylex.props(styles.link)}
        >
          Open agent
        </Link>
      )}
      {message.referenceId && message.noticeKind !== "delegation" && (
        <Button onClick={() => setOpen(true)} xstyle={styles.link}>
          {message.noticeKind === "soul" ? "View change" : "View details"}
        </Button>
      )}
      {open && (
        <Suspense fallback={<span role="status">Loading details…</span>}>
          <NoticeDetails
            agentId={agentId}
            message={message}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

const styles = stylex.create({
  notice: {
    fontSize: 12,
    color: colors.muted,
    marginBlock: 16,
    paddingBlock: 8,
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  reason: { opacity: 0.85 },
  link: { fontSize: 12, paddingInline: 0, color: colors.accent, minHeight: 24 },
});
