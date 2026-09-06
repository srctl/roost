import { usePreferences } from "../../features/settings/preferences";
import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../ui/collapsible";
import { ScrollArea } from "../ui/scroll-area";
import { Icon } from "../ui/primitives";
import type { Message } from "../../features/chat/schema";

export function ToolActivity({ message }: { message: Message }) {
  const { showActivityDetails, responseStyle } = usePreferences();
  const running = message.status === "inProgress";
  const [open, setOpen] = useState(true);
  if (responseStyle === "messages") return null;
  const thinking = message.title === "Thinking";
  const label = thinking ? "Thought summary" : message.title;
  const status = running
    ? "In progress"
    : message.status === "failed"
      ? "Failed"
      : message.status === "interrupted"
        ? "Stopped"
        : "Done";
  const heading = (
    <>
      <Icon name={thinking ? "more" : "monitor"} size={12} />
      <span title={label} {...stylex.props(styles.label)}>
        {label}
      </span>
      <span {...stylex.props(styles.badge, running && styles.running)}>
        {status}
      </span>
      {showActivityDetails && (
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
      )}
    </>
  );
  return (
    <Collapsible
      open={showActivityDetails && open}
      onOpenChange={setOpen}
      {...stylex.props(styles.activity)}
    >
      {showActivityDetails ? (
        <CollapsibleTrigger
          {...stylex.props(styles.trigger, styles.interactive)}
        >
          {heading}
        </CollapsibleTrigger>
      ) : (
        <div {...stylex.props(styles.trigger)}>{heading}</div>
      )}
      <CollapsibleContent {...stylex.props(styles.panel)}>
        {message.details && (
          <>
            <div {...stylex.props(styles.caption)}>
              {message.title === "Command" ? "Command" : "Input"}
            </div>
            <ScrollArea label="Tool input" bounded>
              <pre {...stylex.props(styles.output)}>{message.details}</pre>
            </ScrollArea>
          </>
        )}
        <div {...stylex.props(styles.caption)}>
          {thinking ? "Summary" : "Output"}
        </div>
        {message.text ? (
          <ScrollArea
            label={thinking ? "Thinking summary" : "Tool output"}
            bounded
          >
            <pre {...stylex.props(styles.output)}>{message.text}</pre>
          </ScrollArea>
        ) : (
          <p {...stylex.props(styles.empty)}>
            {running
              ? "Waiting for output…"
              : thinking
                ? "Codex did not provide a summary for this step."
                : "No output returned."}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
const styles = stylex.create({
  activity: {
    marginBlock: 4,
    borderWidth: 0,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 5,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  interactive: { cursor: "pointer" },
  trigger: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 7,
    paddingBlock: 5,
    paddingInline: 7,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.muted,
    font: "inherit",
    fontSize: 11,

    textAlign: "left",
  },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colors.foreground,
  },
  badge: {
    fontSize: 10,
    paddingBlock: 0,
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: colors.bubble,
    color: colors.muted,
  },
  running: { color: colors.accent, backgroundColor: colors.selected },
  panel: { padding: 12, paddingTop: 0 },
  caption: { fontSize: 10, color: colors.muted, marginBlock: 6 },
  output: {
    margin: 0,
    paddingBlock: 6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: "ui-monospace, monospace",
    fontSize: 11,
    color: colors.foreground,
  },
  empty: { color: colors.muted, fontSize: 11 },
});
