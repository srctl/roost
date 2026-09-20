import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import { useId, useRef, useState } from "react";
import {
  isReactionEmoji,
  REACTION_EMOJIS,
} from "../../features/chat/reactions";
import type { Message } from "../../features/chat/schema";
import { colors } from "../../styles/tokens.stylex";
import { Button } from "../ui/button";

const names: Record<string, string> = {
  "👍": "thumbs up",
  "❤️": "heart",
  "😂": "joy",
  "🎉": "celebration",
  "🤔": "thinking",
  "👀": "eyes",
};

export type ReactToMessage = (emoji: string, active: boolean) => Promise<void>;

export function MessageReactions({
  message,
  agentName,
  onReact,
}: {
  message: Message;
  agentName: string;
  onReact?: ReactToMessage;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const inputId = useId();
  const errorId = useId();
  const reactions = message.reactions ?? [];
  const emojis = [...new Set(reactions.map((reaction) => reaction.emoji))];
  const canReact = message.role === "assistant" && !!onReact;
  const selected = (emoji: string) =>
    reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.actor === "user",
    );

  async function choose(emoji: string) {
    if (!onReact || saving.current) return;
    saving.current = true;
    setPending(true);
    setError(undefined);
    setOpen(false);
    try {
      await onReact(emoji, !selected(emoji));
      setCustom("");
    } catch {
      setError("Could not update reaction. Try again.");
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  if (!canReact && !emojis.length) return null;

  return (
    <div {...stylex.props(styles.container)}>
      <fieldset
        aria-label="Message reactions"
        aria-busy={pending}
        {...stylex.props(styles.row)}
      >
        {emojis.map((emoji) => {
          const mine = selected(emoji);
          const actors = reactions.filter(
            (reaction) => reaction.emoji === emoji,
          );
          const label = names[emoji] ?? emoji;
          const by = actors
            .map((reaction) => (reaction.actor === "user" ? "You" : agentName))
            .join(" and ");
          const content = (
            <>
              <span aria-hidden="true">{emoji}</span>
              {actors.length > 1 && <span>{actors.length}</span>}
            </>
          );
          return canReact ? (
            <Button
              key={emoji}
              xstyle={[styles.chip, mine && styles.selected]}
              aria-label={`${mine ? "Remove" : "Add"} ${label} reaction`}
              aria-pressed={mine}
              title={`${by} reacted ${emoji}`}
              disabled={pending}
              onClick={() => void choose(emoji)}
            >
              {content}
            </Button>
          ) : (
            <span
              key={emoji}
              role="img"
              aria-label={`${by} reacted ${label}`}
              title={`${by} reacted ${emoji}`}
              {...stylex.props(styles.chip, styles.readOnlyChip)}
            >
              {content}
            </span>
          );
        })}
        {canReact && (
          <Popover.Root
            open={open}
            onOpenChange={(next) => {
              if (!saving.current || !next) setOpen(next);
            }}
          >
            <Popover.Trigger
              render={<Button xstyle={styles.add} />}
              aria-label="Add reaction"
              title="Add reaction"
              aria-disabled={pending}
            >
              <svg
                aria-hidden="true"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M20 12a8 8 0 1 1-8-8M8 14s1.5 2 4 2 4-2 4-2M8.5 9h.01M14 9h.01M20 3v6M17 6h6" />
              </svg>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                side="top"
                align="start"
                sideOffset={6}
                {...stylex.props(styles.positioner)}
              >
                <Popover.Popup {...stylex.props(styles.popup)}>
                  <Popover.Title {...stylex.props(styles.title)}>
                    Choose a reaction
                  </Popover.Title>
                  <div {...stylex.props(styles.choices)}>
                    {REACTION_EMOJIS.map((emoji) => (
                      <Button
                        key={emoji}
                        xstyle={[
                          styles.choice,
                          selected(emoji) && styles.selected,
                        ]}
                        aria-label={`React with ${names[emoji] ?? emoji}`}
                        aria-pressed={selected(emoji)}
                        onClick={() => void choose(emoji)}
                      >
                        <span aria-hidden="true">{emoji}</span>
                      </Button>
                    ))}
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const emoji = custom.trim();
                      if (!isReactionEmoji(emoji)) {
                        setError("Enter a single emoji.");
                        return;
                      }
                      void choose(emoji);
                    }}
                    {...stylex.props(styles.custom)}
                  >
                    <label htmlFor={inputId} {...stylex.props(styles.label)}>
                      Any emoji
                    </label>
                    <div {...stylex.props(styles.inputRow)}>
                      <input
                        id={inputId}
                        type="text"
                        value={custom}
                        onChange={(event) => {
                          setCustom(event.target.value);
                          setError(undefined);
                        }}
                        placeholder="✨"
                        autoComplete="off"
                        maxLength={64}
                        aria-describedby={error ? errorId : undefined}
                        {...stylex.props(styles.input)}
                      />
                      <Button
                        type="submit"
                        disabled={!custom.trim()}
                        xstyle={styles.submit}
                      >
                        React
                      </Button>
                    </div>
                  </form>
                  {error && (
                    <p
                      id={errorId}
                      role="alert"
                      {...stylex.props(styles.error)}
                    >
                      {error}
                    </p>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        )}
        {pending && (
          <span role="status" {...stylex.props(styles.status)}>
            Saving reaction…
          </span>
        )}
      </fieldset>
      {error && !open && (
        <p id={errorId} role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

const styles = stylex.create({
  container: { marginTop: 5, whiteSpace: "normal", color: colors.foreground },
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    borderWidth: 0,
    padding: 0,
    margin: 0,
    minWidth: 0,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: { default: 28, "@media (pointer: coarse)": 44 },
    minWidth: { default: 34, "@media (pointer: coarse)": 44 },
    paddingBlock: 2,
    paddingInline: 7,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 9,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 1.4,
    outline: { default: null, ":focus-visible": `2px solid ${colors.accent}` },
    outlineOffset: 2,
  },
  readOnlyChip: { minHeight: 26, minWidth: 32 },
  selected: { backgroundColor: colors.selected, borderColor: colors.accent },
  add: {
    minWidth: { default: 30, "@media (pointer: coarse)": 44 },
    minHeight: { default: 30, "@media (pointer: coarse)": 44 },
    padding: 4,
    borderRadius: 8,
    outline: { default: null, ":focus-visible": `2px solid ${colors.accent}` },
    outlineOffset: 2,
  },
  positioner: { zIndex: 50 },
  popup: {
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
    lineHeight: 1.6,
    width: 284,
    maxWidth: "calc(100vw - 24px)",
    boxSizing: "border-box",
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    color: colors.foreground,
    boxShadow: "0 8px 32px #0002",
    outline: "none",
  },
  title: { margin: 0, marginBottom: 8, fontSize: 12, fontWeight: 500 },
  choices: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(6, 1fr)",
      "@media (pointer: coarse)": "repeat(3, 1fr)",
    },
    gap: 2,
  },
  choice: {
    minWidth: 0,
    minHeight: 44,
    padding: 4,
    fontSize: 22,
    borderRadius: 8,
  },
  custom: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  label: {
    display: "block",
    marginBottom: 5,
    fontSize: 11,
    color: colors.muted,
  },
  inputRow: { display: "flex", gap: 8 },
  input: {
    minWidth: 0,
    width: "100%",
    minHeight: { default: 36, "@media (pointer: coarse)": 44 },
    paddingInline: 8,
    paddingBlock: 4,
    boxSizing: "border-box",
    backgroundColor: colors.background,
    color: colors.foreground,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 6,
    fontSize: 16,
    outlineColor: colors.accent,
  },
  submit: {
    paddingInline: 10,
    backgroundColor: colors.selected,
    color: colors.foreground,
  },
  status: { fontSize: 11, color: colors.muted },
  error: { margin: 0, marginTop: 4, fontSize: 11, color: colors.foreground },
});
