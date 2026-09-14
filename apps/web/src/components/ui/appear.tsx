import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";
import { useMountedAfterLoad } from "../../features/motion";
import { motion } from "../../styles/motion.stylex";

/**
 * An inline wrapper that animates in when it mounts after the page has loaded.
 * Server-rendered instances stay still, so startup never replays entrances.
 */
export function Appear({
  xstyle,
  pop = false,
  ...props
}: Omit<ComponentProps<"span">, "className" | "style"> & {
  xstyle?: stylex.StyleXStyles;
  /** Scale in from the centre instead of rising into place. */
  pop?: boolean;
}) {
  const live = useMountedAfterLoad();

  return (
    <span
      {...props}
      {...stylex.props(
        styles.appear,
        live && (pop ? styles.pop : styles.rise),
        xstyle,
      )}
    />
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

const pop = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.5)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const styles = stylex.create({
  appear: { display: "block" },
  rise: {
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut,
    animationFillMode: "backwards",
  },
  pop: {
    animationName: pop,
    animationDuration: motion.base,
    animationTimingFunction: motion.spring,
    animationFillMode: "backwards",
  },
});
