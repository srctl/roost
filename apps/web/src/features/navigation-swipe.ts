/** Adds a swipe shortcut without taking over native scrolling or zoom. */
export function listenForNavigationSwipe(
  surface: HTMLElement,
  enabled: () => boolean,
  onSwipe: () => void,
  direction: "left" | "right" = "right",
) {
  const sign = direction === "right" ? 1 : -1;
  let start: { id: number; x: number; y: number; time: number } | null = null;

  const reset = () => {
    start = null;
  };

  const onStart = (event: TouchEvent) => {
    reset();
    if (!enabled() || event.touches.length !== 1) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [role="slider"], canvas, video',
      )
    )
      return;
    // Closing should also work across agent links. Ignore any nested dialog,
    // while allowing gestures inside the navigation dialog itself.
    if (direction === "right" && target.closest("a")) return;
    const dialog = target.closest('[role="dialog"]');
    if (dialog && dialog !== surface) return;
    if (!window.getSelection()?.isCollapsed) return;

    // Code blocks, tables, resize handles, and the remote computer own their
    // horizontal gestures. Leave those alone even at the edge of their scroll.
    for (
      let element: Element | null = target;
      element;
      element = element.parentElement
    ) {
      const style = window.getComputedStyle(element);
      if (
        style.touchAction === "none" ||
        style.touchAction.includes("pan-x") ||
        (element.scrollWidth > element.clientWidth + 1 &&
          /auto|scroll/.test(style.overflowX))
      )
        return;
      if (element === surface) break;
    }

    const touch = event.touches[0]!;
    start = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      time: event.timeStamp,
    };
  };

  const onMove = (event: TouchEvent) => {
    if (!start) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || touch?.identifier !== start.id) {
      reset();
      return;
    }
    const dx = (touch.clientX - start.x) * sign;
    const dy = Math.abs(touch.clientY - start.y);
    // Once scrolling or swiping the other way, do not reinterpret it later.
    if (dx < -12 || (dy > 12 && dy > Math.abs(dx))) reset();
  };

  const onEnd = (event: TouchEvent) => {
    const origin = start;
    reset();
    if (!origin || !enabled() || event.touches.length) return;
    const touch = Array.from(event.changedTouches).find(
      (touch) => touch.identifier === origin.id,
    );
    if (!touch) return;
    const dx = (touch.clientX - origin.x) * sign;
    const dy = Math.abs(touch.clientY - origin.y);
    if (
      dx >= 72 &&
      dx > dy * 2 &&
      event.timeStamp - origin.time <= 700 &&
      window.getSelection()?.isCollapsed
    )
      onSwipe();
  };

  surface.addEventListener("touchstart", onStart, { passive: true });
  surface.addEventListener("touchmove", onMove, { passive: true });
  surface.addEventListener("touchend", onEnd, { passive: true });
  surface.addEventListener("touchcancel", reset, { passive: true });
  return () => {
    surface.removeEventListener("touchstart", onStart);
    surface.removeEventListener("touchmove", onMove);
    surface.removeEventListener("touchend", onEnd);
    surface.removeEventListener("touchcancel", reset);
  };
}
