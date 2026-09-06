import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Icon } from "../ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";
import { usePreferences } from "../../features/settings/preferences";

export function Composer({
  agentName,
  busy,
  status,
  onSend,
  onStop,
}: {
  agentName: string;
  busy: boolean;
  status?: string;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const resize = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    let width = element.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text]);
  const { responseStyle } = usePreferences();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !text.trim()) return;
    void onSend(text.trim());
    setText("");
  }
  return (
    <form onSubmit={submit} {...stylex.props(styles.composerArea)}>
      {busy && responseStyle === "codex" && (
        <div role="status" {...stylex.props(styles.progress)}>
          <span {...stylex.props(styles.progressDot)} />
          <span>{`${status ?? "Replying"}…`}</span>
        </div>
      )}
      <div {...stylex.props(styles.composer)}>
        <textarea
          ref={input}
          aria-label={`Message ${agentName}`}
          placeholder={`Message ${agentName}…`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={32000}
          rows={1}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          {...stylex.props(styles.input)}
        />
        {busy ? (
          <Button
            key="stop"
            type="button"
            onClick={onStop}
            aria-label="Stop response"
            xstyle={styles.send}
          >
            <span aria-hidden="true" {...stylex.props(styles.stopIcon)} />
          </Button>
        ) : (
          <Button
            key="send"
            type="submit"
            disabled={!text.trim()}
            aria-label="Send message"
            xstyle={styles.send}
          >
            <Icon name="up" size={16} />
          </Button>
        )}
      </div>
    </form>
  );
}
const styles = stylex.create({
  composerArea: {
    marginTop: "auto",
    flexShrink: 0,
    paddingTop: { default: 20, "@media (max-width: 700px)": 8 },
    paddingInline: { default: 0, "@media (max-width: 700px)": 12 },
    paddingBottom: {
      default: 0,
      "@media (max-width: 700px)":
        "max(12px, var(--roost-bottom-inset, env(safe-area-inset-bottom)))",
    },
  },
  progress: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: colors.muted,
    fontSize: 10,
    marginBottom: 10,
  },
  progressDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    backgroundColor: colors.accent,
  },
  stopIcon: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: "currentColor",
  },
  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: colors.border, ":focus-within": colors.accent },
    borderRadius: 14,
    padding: 10,
    boxShadow: "0 2px 8px #00000003",
  },
  input: {
    display: "block",
    resize: "none",
    width: "100%",
    minWidth: 0,
    minHeight: 24,
    maxHeight: "calc(3lh + 6px)",
    marginBlock: 2,
    overflowY: "auto",
    scrollbarWidth: "thin",
    scrollbarColor: `${colors.border} transparent`,
    backgroundColor: "transparent",
    color: colors.foreground,
    borderWidth: 0,
    outline: "none",
    padding: 3,
    fontSize: { default: 12, "@media (max-width: 700px)": 16 },
    lineHeight: 1.5,
    "::placeholder": { color: colors.muted },
  },
  send: {
    display: "grid",
    placeItems: "center",
    marginLeft: "auto",
    width: { default: 28, "@media (max-width: 700px)": 40 },
    height: { default: 28, "@media (max-width: 700px)": 40 },
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: "50%",
    backgroundColor: colors.action,
    color: colors.onAccent,
  },
});
