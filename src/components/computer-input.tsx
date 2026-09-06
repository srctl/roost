import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import type RFB from "@novnc/novnc/lib/rfb.js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";
import { desktopKeys } from "../features/computer/keyboard";

export function ComputerInput({
  client,
  desktop,
  enabled,
  children,
}: {
  client: RefObject<RFB | null>;
  desktop: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  children: ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const [trackpad, setTrackpad] = useState(false);
  const [pointer, setPointer] = useState<{ left: number; top: number }>();
  const position = useRef({ x: 0.5, y: 0.5 });
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ distance: 0, multiple: false });
  useEffect(() => {
    setTrackpad(matchMedia("(pointer: coarse)").matches);
  }, []);
  useEffect(() => {
    if (!enabled) {
      keyboard.current?.blur();
      touches.current.clear();
      setPointer(undefined);
    }
  }, [enabled]);

  function mouse(type: string, x = position.current.x, y = position.current.y) {
    const rfb = client.current;
    const canvas = desktop.current?.querySelector("canvas");
    if (!enabled || !rfb || rfb.viewOnly || !canvas) return;
    position.current = {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
    const rect = canvas.getBoundingClientRect();
    const parent = area.current!.getBoundingClientRect();
    const clientX = rect.left + position.current.x * (rect.width - 1);
    const clientY = rect.top + position.current.y * (rect.height - 1);
    setPointer({ left: clientX - parent.left, top: clientY - parent.top });
    // Use noVNC's normal canvas input path, including its view-only and scaling checks.
    // Mouse-up must pass through noVNC's window capture proxy so it releases capture.
    (type === "mouseup" ? window : canvas).dispatchEvent(
      new MouseEvent(type, {
        clientX,
        clientY,
        button: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  function send(text: string) {
    if (!enabled || !client.current || client.current.viewOnly) return;
    for (const key of desktopKeys(text)) client.current.sendKey(key);
  }

  function flush(input: HTMLTextAreaElement) {
    // A leading space lets mobile keyboards generate backspace even with no local text.
    if (!input.value) send("\b");
    else send(input.value.startsWith(" ") ? input.value.slice(1) : input.value);
    input.value = " ";
    input.setSelectionRange(1, 1);
  }

  return (
    <>
      <div ref={area} {...stylex.props(styles.area)}>
        {children}
        {enabled && trackpad && (
          <div
            aria-label="Desktop trackpad"
            {...stylex.props(styles.trackpad)}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              if (!touches.current.size)
                gesture.current = { distance: 0, multiple: false };
              touches.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              });
              if (touches.current.size > 1) gesture.current.multiple = true;
            }}
            onPointerMove={(event) => {
              const last = touches.current.get(event.pointerId);
              const canvas = desktop.current?.querySelector("canvas");
              if (!last || !canvas || !enabled || client.current?.viewOnly)
                return;
              const dx = event.clientX - last.x,
                dy = event.clientY - last.y;
              gesture.current.distance += Math.abs(dx) + Math.abs(dy);
              touches.current.set(event.pointerId, {
                x: event.clientX,
                y: event.clientY,
              });
              if (touches.current.size > 1) {
                const rect = canvas.getBoundingClientRect();
                canvas.dispatchEvent(
                  new WheelEvent("wheel", {
                    deltaX: -dx,
                    deltaY: -dy,
                    clientX: rect.left + position.current.x * rect.width,
                    clientY: rect.top + position.current.y * rect.height,
                    bubbles: true,
                    cancelable: true,
                  }),
                );
              } else if (!gesture.current.multiple) {
                const rect = canvas.getBoundingClientRect();
                mouse(
                  "mousemove",
                  position.current.x + dx / rect.width,
                  position.current.y + dy / rect.height,
                );
              }
            }}
            onPointerUp={(event) => {
              if (!touches.current.delete(event.pointerId)) return;
              if (!gesture.current.multiple && gesture.current.distance < 6) {
                mouse("mousedown");
                mouse("mouseup");
              }
            }}
            onPointerCancel={() => {
              touches.current.clear();
            }}
          />
        )}
        {enabled && trackpad && pointer && (
          <span
            aria-hidden="true"
            style={pointer}
            {...stylex.props(styles.pointer)}
          >
            <Icon name="pointer" size={22} />
          </span>
        )}
      </div>
      <div {...stylex.props(styles.controls)}>
        <Button
          disabled={!enabled}
          aria-pressed={trackpad}
          onClick={() => {
            setTrackpad(!trackpad);
            setPointer(undefined);
          }}
        >
          <Icon name="pointer" /> {trackpad ? "Trackpad" : "Direct touch"}
        </Button>
        <Button
          disabled={!enabled}
          aria-label="Recenter pointer"
          title="Recenter pointer"
          onClick={() => mouse("mousemove", 0.5, 0.5)}
        >
          <Icon name="recenter" />
        </Button>
        <span {...stylex.props(styles.spacer)} />
        <Button
          disabled={!enabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => send("\t")}
          aria-label="Send Tab key"
        >
          Tab
        </Button>
        <Button
          disabled={!enabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => send("\n")}
          aria-label="Send Enter key"
        >
          ↵
        </Button>
        <Button
          disabled={!enabled}
          aria-label="Show keyboard"
          title="Show keyboard"
          onClick={() => {
            keyboard.current?.focus({ preventScroll: true });
            keyboard.current?.setSelectionRange(1, 1);
          }}
        >
          <Icon name="keyboard" />
        </Button>
        <textarea
          ref={keyboard}
          aria-label="Type on the remote computer"
          defaultValue=" "
          disabled={!enabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          {...stylex.props(styles.keyboard)}
          onInput={(event) => {
            if (!(event.nativeEvent as InputEvent).isComposing)
              flush(event.currentTarget);
          }}
          onCompositionEnd={(event) => flush(event.currentTarget)}
          onKeyDown={(event) => {
            const key = { Enter: "\n", Tab: "\t", Backspace: "\b" }[event.key];
            if (key && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(key);
            }
          }}
        />
      </div>
      <p {...stylex.props(styles.hint)}>
        {enabled
          ? trackpad
            ? "Slide to move · tap to click · two fingers to scroll"
            : "Tap the desktop to click · two fingers to scroll"
          : "Take control to use the mouse and keyboard"}
      </p>
    </>
  );
}

const styles = stylex.create({
  area: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    display: "flex",
  },
  trackpad: {
    position: "absolute",
    inset: 0,
    touchAction: "none",
    userSelect: "none",
  },
  pointer: {
    position: "absolute",
    pointerEvents: "none",
    color: "white",
    filter: "drop-shadow(0 1px 2px #000)",
    transform: "translate(-3px, -2px)",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingInline: 12,
    paddingTop: 6,
    flexShrink: 0,
  },
  spacer: { flex: 1 },
  keyboard: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    padding: 0,
    borderWidth: 0,
    fontSize: 16,
    bottom: 0,
    left: 0,
  },
  hint: {
    fontSize: 11,
    color: "#a6aaa0",
    textAlign: "center",
    margin: 0,
    paddingBlock: 6,
    paddingInline: 12,
    flexShrink: 0,
  },
});
