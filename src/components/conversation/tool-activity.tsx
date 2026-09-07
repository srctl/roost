import * as stylex from "@stylexjs/stylex";
import { memo, useState } from "react";
import { getActivityOutput } from "../../features/chat/functions";
import type { Message } from "../../features/chat/schema";
import { usePreferences } from "../../features/settings/preferences";
import { motion } from "../../styles/motion.stylex";
import { colors } from "../../styles/tokens.stylex";
import { Button } from "../ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Icon } from "../ui/primitives";
import { ScrollArea } from "../ui/scroll-area";

export const ToolActivity = memo(function ToolActivity({
  agentId,
  message: preview,
  entering = false,
}: {
  agentId?: string;
  message: Message;
  /** Fades the row in when it first appears during this visit. */
  entering?: boolean;
}) {
  const [full, setFull] = useState<{ preview: Message; message: Message }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const message = full?.preview === preview ? full.message : preview;
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
        <span {...stylex.props(styles.chevron, open && styles.chevronOpen)}>
          <Icon name="chevron-right" size={12} />
        </span>
      )}
    </>
  );

  return (
    <Collapsible
      open={showActivityDetails && open}
      onOpenChange={setOpen}
      {...stylex.props(styles.activity, entering && styles.enter)}
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
        <div {...stylex.props(styles.panelBody)}>
          {agentId && message.truncated && (
            <Button
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError(false);
                try {
                  const result = await getActivityOutput({
                    data: { agentId, id: message.id },
                  });
                  if (result.ok && result.value)
                    setFull({ preview, message: result.value });
                  else setError(true);
                } catch {
                  setError(true);
                } finally {
                  setLoading(false);
                }
              }}
            >
              {loading ? "Loading full output…" : "Load full output"}
            </Button>
          )}
          {error && <p role="alert">Could not load full output. Try again.</p>}
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

const fadeUp = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(6px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

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
  enter: {
    animationName: fadeUp,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut,
    animationFillMode: "backwards",
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
    borderRadius: 5,
    backgroundColor: {
      default: "transparent",
      "@media (hover: hover)": {
        ":hover": "color-mix(in srgb, currentColor 6%, transparent)",
      },
    },
    color: colors.muted,
    font: "inherit",
    fontSize: 11,
    textAlign: "left",
    transitionProperty: "background-color",
    transitionDuration: motion.fast,
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
    transitionProperty: "background-color, color",
    transitionDuration: motion.base,
  },
  running: { color: colors.accent, backgroundColor: colors.selected },
  chevron: {
    display: "inline-flex",
    transform: "rotate(0deg)",
    transitionProperty: "transform",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut,
  },
  chevronOpen: { transform: "rotate(90deg)" },
  // Base UI measures the panel and exposes its height while it opens or closes.
  panel: {
    height: {
      default: "var(--collapsible-panel-height)",
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    opacity: {
      default: 1,
      ":is([data-starting-style], [data-ending-style])": 0,
    },
    overflow: "hidden",
    transitionProperty: "height, opacity",
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut,
  },
  panelBody: { padding: 12, paddingTop: 0 },
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
