import * as stylex from "@stylexjs/stylex";
import type { RefObject } from "react";
import { colors } from "../../styles/tokens.stylex";

/**
 * A keyboard- and pointer-operable splitter that sits on the right edge of a
 * pane. It reports the pane's new width in pixels; the owner clamps and stores.
 */
export function ResizeHandle({
  label,
  controls,
  pane,
  value,
  min,
  max,
  step = 24,
  onResize,
}: {
  label: string;
  /** Id of the pane the handle resizes, for assistive technology. */
  controls: string;
  /** The pane element, used to measure the pointer's distance from its left edge. */
  pane: RefObject<HTMLElement | null>;
  value: number;
  min: number;
  max: number;
  /** Width change for each arrow key press. */
  step?: number;
  onResize: (width: number) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: This is an interactive pane splitter, not a thematic break.
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      {...stylex.props(styles.handle)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (
          !event.currentTarget.hasPointerCapture(event.pointerId) ||
          !pane.current
        )
          return;
        onResize(event.clientX - pane.current.getBoundingClientRect().left);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        if (event.key === "Home") onResize(min);
        else if (event.key === "End") onResize(max);
        else onResize(value + (event.key === "ArrowRight" ? step : -step));
      }}
    >
      <span {...stylex.props(styles.line)} />
    </div>
  );
}

const styles = stylex.create({
  handle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 8,
    zIndex: 1,
    display: "flex",
    justifyContent: "flex-end",
    cursor: "col-resize",
    touchAction: "none",
    outlineOffset: -2,
    color: {
      default: "transparent",
      ":hover": colors.muted,
      ":focus-visible": colors.accent,
    },
  },
  line: { width: 1, backgroundColor: "currentColor" },
});
