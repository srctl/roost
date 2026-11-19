import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { colors } from "../../styles/tokens.stylex";

/** A placeholder block for content that is still loading. */
export function Skeleton({ xstyle }: { xstyle?: stylex.StyleXStyles }) {
  return <div aria-hidden="true" {...stylex.props(styles.block, xstyle)} />;
}

/**
 * Announces a loading region and fades its placeholders in after a short
 * delay, so data that arrives quickly replaces them without a flash.
 */
export function SkeletonGroup({
  label,
  xstyle,
  children,
}: {
  label: string;
  xstyle?: stylex.StyleXStyles;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      {...stylex.props(styles.group, xstyle)}
    >
      {children}
    </div>
  );
}

const pulse = stylex.keyframes({
  "0%": { opacity: 1 },
  "50%": { opacity: 0.55 },
  "100%": { opacity: 1 },
});

const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const styles = stylex.create({
  group: {
    animationName: fadeIn,
    animationDuration: "200ms",
    animationDelay: "150ms",
    animationFillMode: "backwards",
  },
  block: {
    backgroundColor: colors.bubble,
    borderRadius: 8,
    height: 14,
    animationName: {
      default: pulse,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: "1.6s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
});
