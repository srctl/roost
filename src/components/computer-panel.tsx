import { useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import type RFB from "@novnc/novnc/lib/rfb.js";
import { openComputer, controlComputer } from "../features/computer/functions";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";
import { colors } from "../styles/tokens.stylex";

export function ComputerPanel({ onClose }: { onClose: () => void }) {
  const screen = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const client = useRef<RFB | null>(null);
  const session = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    let rfb: RFB | undefined;
    setConnected(false);
    setControlling(false);
    setError(undefined);
    const connect = async () => {
      try {
        const result = await openComputer();
        if (!current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const module = await import("@novnc/novnc/lib/rfb.js");
        // The npm CommonJS build is wrapped once more by production code splitting.
        const Client =
          typeof module.default === "function"
            ? module.default
            : (module.default as unknown as { default: typeof RFB }).default;
        if (!current || !screen.current) return;
        session.current = result.value.id;
        const url = new URL("/api/desktop/socket", window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("ticket", result.value.id);
        rfb = new Client(screen.current, url.href);
        client.current = rfb;
        rfb.viewOnly = true;
        rfb.scaleViewport = true;
        rfb.resizeSession = false; // Watching never changes the desktop's geometry.
        rfb.background = "#171a16";
        rfb.addEventListener("connect", () => {
          if (current) setConnected(true);
        });
        rfb.addEventListener("disconnect", () => {
          if (!current) return;
          setConnected(false);
          setControlling(false);
          setError("Desktop disconnected. Reconnect to continue watching.");
        });
        rfb.addEventListener("securityfailure", () => {
          if (current)
            setError(
              "The desktop rejected the connection. Check the machine's VNC configuration.",
            );
        });
      } catch {
        if (current) setError("Could not connect to this machine’s desktop.");
      }
    };
    void connect();
    return () => {
      current = false;
      rfb?.disconnect();
      client.current = null;
      session.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    if (!controlling) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const renew = async () => {
      try {
        if (!session.current) throw new Error();
        const result = await controlComputer({
          data: { id: session.current, control: true },
        });
        if (!result.ok) throw new Error();
      } catch {
        if (current) {
          if (client.current) client.current.viewOnly = true;
          setControlling(false);
          setError("Control was interrupted. Take control again to continue.");
        }
      }
      if (current) timer = setTimeout(renew, 8000);
    };
    timer = setTimeout(renew, 8000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [controlling]);
  async function toggleControl() {
    if (!session.current || !client.current || busy) return;
    setBusy(true);
    setError(undefined);
    // Stop sending input before handing the desktop back to agents.
    client.current.viewOnly = true;
    try {
      const result = await controlComputer({
        data: { id: session.current, control: !controlling },
      });
      if (!result.ok) {
        setError(result.error);
        setControlling(false);
        return;
      }
      setControlling(result.value.controlling);
      if (client.current) {
        client.current.viewOnly = !result.value.controlling;
        if (result.value.controlling) client.current.focus();
      }
    } catch {
      setControlling(false);
      setError("Could not change desktop control. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={panel} {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.toolbar)}>
        <span {...stylex.props(styles.title)}>
          <Icon name="monitor" /> Computer
        </span>
        <span role="status" {...stylex.props(styles.status)}>
          {connected
            ? controlling
              ? "You’re in control · agent input paused"
              : "Live · watching"
            : error
              ? "Disconnected"
              : "Connecting…"}
        </span>
        <div {...stylex.props(styles.actions)}>
          {connected && (
            <Button
              disabled={busy}
              onClick={() => void toggleControl()}
              xstyle={controlling ? styles.active : undefined}
            >
              {controlling ? "Return control" : "Take control"}
            </Button>
          )}
          {error && !connected && (
            <Button onClick={() => setAttempt((value) => value + 1)}>
              Reconnect
            </Button>
          )}
          <Button
            aria-label="Toggle desktop full screen"
            onClick={() => {
              void (
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : panel.current?.requestFullscreen()
              )?.catch(() =>
                setError("Full screen is unavailable in this browser."),
              );
            }}
          >
            <Icon name="monitor" />
          </Button>
          <Button aria-label="Close desktop" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      <div
        ref={screen}
        {...stylex.props(styles.screen)}
        aria-label="Remote desktop"
      />
      <p {...stylex.props(styles.note)}>
        This machine’s shared desktop and signed-in browser. Closing the preview
        leaves them running.
      </p>
    </div>
  );
}
const styles = stylex.create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 180,
    height: { default: "38svh", ":fullscreen": "100%" },
    backgroundColor: colors.background,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 10,
    overflow: "hidden",
    marginBlock: 8,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    paddingBlock: 6,
    paddingInline: 10,
    flexShrink: 0,
  },
  title: { display: "flex", alignItems: "center", gap: 6, fontSize: 12 },
  status: { color: colors.muted, fontSize: 11 },
  actions: {
    display: "flex",
    gap: 4,
    alignItems: "center",
    marginLeft: "auto",
  },
  active: { color: colors.onAccent, backgroundColor: colors.accent },
  screen: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "hidden",
    backgroundColor: "#171a16",
  },
  note: {
    margin: 0,
    paddingBlock: 5,
    paddingInline: 10,
    color: colors.muted,
    fontSize: 10,
  },
  error: {
    margin: 0,
    paddingInline: 10,
    paddingBottom: 6,
    color: colors.muted,
    fontSize: 12,
  },
});
