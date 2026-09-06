import * as stylex from "@stylexjs/stylex";
import { colors } from "../styles/tokens.stylex";
import type { AgentActivity } from "../server/agents/activity.server";

const labels = {
  working: "Working",
  queued: "Queued",
  delegating: "Waiting on another agent",
};

export function AgentWorking({ activity }: { activity: AgentActivity }) {
  return (
    <span
      role="img"
      aria-label={labels[activity]}
      title={labels[activity]}
      {...stylex.props(styles.container)}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        shapeRendering="crispEdges"
        {...stylex.props(
          styles.pixel,
          activity === "working" && styles.working,
          activity !== "working" && styles.waiting,
        )}
      >
        <path
          fill="currentColor"
          d="M8 2h2v4h4v2h2v2h-2v2h-4v4H8v-4H4v-2H2V8h2V6h4z"
        />
        <path fill="#20221e" d="M6 8h2v2H6zm4 0h2v2h-2z" />
      </svg>
    </span>
  );
}

const twinkle = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0)", opacity: 1 },
  "50%": { transform: "translateY(-2px)", opacity: 0.6 },
});

const styles = stylex.create({
  container: {
    display: "inline-flex",
    marginLeft: "auto",
    flexShrink: 0,
    paddingLeft: 4,
  },
  pixel: { color: colors.accent },
  working: {
    animationName: twinkle,
    animationDuration: "900ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "steps(2, end)",
    animationPlayState: {
      default: "running",
      "@media (prefers-reduced-motion: reduce)": "paused",
    },
  },
  waiting: { color: colors.muted, opacity: 0.6 },
});
