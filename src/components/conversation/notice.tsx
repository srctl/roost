import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type { Message } from "../../features/chat/schema";
import { colors } from "../../styles/tokens.stylex";
import { Button } from "../ui/button";
import { Inspector } from "../ui/inspector";
import { SoulChangeDetails } from "../soul-change";
import {
  AgentAutomationSettings,
  RunInspector,
} from "../agent-automation-settings";

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
      {message.referenceId && (
        <Button onClick={() => setOpen(true)} xstyle={styles.link}>
          {message.noticeKind === "soul" ? "View change" : "View details"}
        </Button>
      )}
      {open &&
        (message.noticeKind === "soul" ? (
          <SoulChangeDetails
            agentId={agentId}
            id={message.referenceId!}
            onClose={() => setOpen(false)}
          />
        ) : message.noticeKind === "run" ? (
          <RunInspector
            agentId={agentId}
            id={message.referenceId!}
            onClose={() => setOpen(false)}
          />
        ) : (
          <Inspector title="Automations" onClose={() => setOpen(false)}>
            <AgentAutomationSettings
              agentId={agentId}
              selectedId={message.referenceId}
            />
          </Inspector>
        ))}
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
