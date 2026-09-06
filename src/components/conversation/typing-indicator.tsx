import * as stylex from "@stylexjs/stylex";
import { colors } from "../../styles/tokens.stylex";

export function TypingIndicator({ name }: { name: string }) {
  return (
    <div
      role="status"
      aria-label={`${name} is replying`}
      {...stylex.props(styles.bubble)}
    >
      <span aria-hidden="true" {...stylex.props(styles.dot)} />
      <span aria-hidden="true" {...stylex.props(styles.dot, styles.second)} />
      <span aria-hidden="true" {...stylex.props(styles.dot, styles.third)} />
    </div>
  );
}

const pulse = stylex.keyframes({
  "0%, 60%, 100%": { opacity: 0.4, transform: "translateY(0)" },
  "30%": { opacity: 1, transform: "translateY(-3px)" },
});

const styles = stylex.create({
  bubble: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    width: "fit-content",
    marginTop: 8,
    paddingBlock: 15,
    paddingInline: 16,
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    backgroundColor: colors.bubble,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: colors.muted,
    animationName: {
      default: pulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "1.2s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  second: { animationDelay: "0.15s" },
  third: { animationDelay: "0.3s" },
});
