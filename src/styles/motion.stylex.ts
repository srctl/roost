import * as stylex from "@stylexjs/stylex";

/* Shared motion tokens. Durations collapse to zero when the visitor prefers
   reduced motion, so every transition or animation that reads them respects
   that setting without a per-component media query. */
export const motion = stylex.defineVars({
  fast: {
    default: "120ms",
    "@media (prefers-reduced-motion: reduce)": "0ms",
  },
  base: {
    default: "220ms",
    "@media (prefers-reduced-motion: reduce)": "0ms",
  },
  slow: {
    default: "320ms",
    "@media (prefers-reduced-motion: reduce)": "0ms",
  },
  /* Decelerating: content arriving on screen. */
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  /* Symmetric: layout that moves from one resting place to another. */
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  /* Slight overshoot: small elements that pop into place. */
  spring: "cubic-bezier(0.34, 1.4, 0.64, 1)",
});
