import { Dialog } from "@base-ui/react/dialog";
import type RFB from "@novnc/novnc/lib/rfb.js";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import { controlComputer, openComputer } from "../features/computer/functions";
import { colors } from "../styles/tokens.stylex";
import { ComputerInput } from "./computer-input";
import { Button } from "./ui/button";
import { Icon } from "./ui/primitives";

export function ComputerPanel({
  onClose,
  agentName,
  fullScreen = false,
}: {
  onClose: () => void;
  agentName: string;
  fullScreen?: boolean;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const desktop = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(fullScreen);
  const mountScreen = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    screen.current = node;
    if (desktop.current) node.appendChild(desktop.current);
  }, []);
  useEffect(() => {
    if (client.current) client.current.focusOnClick = !expanded;
    if (!expanded) return;
    const viewport = window.visualViewport;

    const resize = () => {
      if (!popup.current || !viewport) return;
      Object.assign(popup.current.style, {
        height: `${viewport.height}px`,
        width: `${viewport.width}px`,
        top: `${viewport.offsetTop}px`,
        left: `${viewport.offsetLeft}px`,
      });
    };

    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);

    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
    };
  }, [expanded]);
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
        const target = document.createElement("div");
        Object.assign(target.style, {
          width: "100%",
          height: "100%",
          minHeight: "0",
        });
        screen.current.appendChild(target);
        desktop.current = target;
        rfb = new Client(target, url.href);
        client.current = rfb;
        rfb.viewOnly = true;
        rfb.scaleViewport = true;
        rfb.resizeSession = false; // Watching never changes the desktop's geometry.
        rfb.background = "#080a08";
        rfb.focusOnClick = !popup.current;
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
      desktop.current?.remove();
      desktop.current = null;
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

  const status = connected
    ? controlling
      ? "You’re in control"
      : "Live · watching"
    : error
      ? "Disconnected"
      : "Connecting…";
  const control = connected ? (
    <Button
      disabled={busy}
      onClick={() => void toggleControl()}
      xstyle={controlling ? styles.active : undefined}
    >
      {controlling ? "Return control" : "Take control"}
    </Button>
  ) : error ? (
    <Button onClick={() => setAttempt((value) => value + 1)}>Reconnect</Button>
  ) : null;
  const display = (
    // biome-ignore lint/a11y/useSemanticElements: This groups the remote desktop canvas, not form fields.
    <div
      ref={mountScreen}
      {...stylex.props(styles.screen)}
      role="group"
      aria-label="Remote desktop"
    />
  );
  const notice = error && (
    <p role="alert" {...stylex.props(styles.error)}>
      {error}
    </p>
  );

  return (
    <Dialog.Root
      open={expanded}
      onOpenChange={(open) => {
        if (!open && fullScreen) onClose();
        else setExpanded(open);
      }}
    >
      {!expanded && (
        <div {...stylex.props(styles.panel)}>
          <div {...stylex.props(styles.toolbar)}>
            <span {...stylex.props(styles.title)}>
              <Icon name="monitor" /> Computer
            </span>
            <span role="status" {...stylex.props(styles.status)}>
              {status}
            </span>
            <div {...stylex.props(styles.actions)}>
              {control}
              <Dialog.Trigger
                render={
                  <Button ref={expandButton} aria-label="Expand desktop" />
                }
              >
                <Icon name="expand" />
              </Dialog.Trigger>
              <Button aria-label="Close desktop" onClick={onClose}>
                <Icon name="close" />
              </Button>
            </div>
          </div>
          {notice}
          {display}
          <p {...stylex.props(styles.note)}>
            This machine’s shared desktop and signed-in browser. Closing the
            preview leaves them running.
          </p>
        </div>
      )}
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(styles.backdrop)} />
        <Dialog.Popup
          ref={popup}
          finalFocus={fullScreen ? undefined : expandButton}
          {...stylex.props(styles.expanded)}
        >
          <div {...stylex.props(styles.expandedHeader)}>
            <Dialog.Close
              render={
                <Button
                  aria-label="Back to conversation"
                  xstyle={styles.back}
                />
              }
            >
              <Icon name="chevron-left" size={22} />
            </Dialog.Close>
            <div {...stylex.props(styles.heading)}>
              <Dialog.Title {...stylex.props(styles.expandedTitle)}>
                {agentName}’s computer
              </Dialog.Title>
              <Dialog.Description
                role="status"
                {...stylex.props(styles.expandedStatus)}
              >
                {status}
              </Dialog.Description>
            </div>
            {control}
          </div>
          {notice}
          <ComputerInput
            client={client}
            desktop={desktop}
            enabled={connected && controlling}
          >
            {display}
          </ComputerInput>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
    backgroundColor: "#080a08",
  },
  expanded: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100%",
    height: "100dvh",
    zIndex: 31,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: "#080a08",
    color: "#eceee8",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    fontSize: 13,
    lineHeight: 1.5,
    paddingTop: "env(safe-area-inset-top)",
    paddingBottom: "env(safe-area-inset-bottom)",
    paddingLeft: "env(safe-area-inset-left)",
    paddingRight: "env(safe-area-inset-right)",
    outline: "none",
  },
  expandedHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBlock: 10,
    paddingInline: 12,
    flexShrink: 0,
  },
  back: {
    borderRadius: "50%",
    minWidth: 44,
    minHeight: 44,
    backgroundColor: "#20231e",
    color: "#eceee8",
  },
  heading: { flex: 1, minWidth: 0 },
  expandedTitle: {
    fontSize: 16,
    fontWeight: 500,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  expandedStatus: { fontSize: 11, color: colors.muted, margin: 0 },
  panel: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 180,
    height: "38svh",
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
    backgroundColor: "#080a08",
    width: "100%",
    height: "100%",
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
