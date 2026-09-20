import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectLink,
  disconnectLink,
  type getPaymentSettings,
  refreshPayments,
} from "../features/payments/functions";
import type {
  PaymentPurchase,
  PaymentSettings,
} from "../features/payments/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";

type PaymentResult = Awaited<ReturnType<typeof getPaymentSettings>>;
type Operation = "connect" | "refresh" | "disconnect";

const statusLabels: Record<string, string> = {
  creating: "Preparing request",
  awaiting_approval: "Awaiting your approval",
  approved: "Approved · checkout pending",
  processing: "Processing payment",
  requires_action: "Action needed in Link",
  completed: "Completed",
  declined: "Declined",
  canceled: "Canceled",
  expired: "Expired",
  failed: "Failed",
  unknown: "Status unavailable",
};

function formatAmount(purchase: PaymentPurchase) {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: purchase.currency,
  });
  const decimals = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(purchase.amount / 10 ** decimals);
}

export function PaymentsSetting({
  initial,
  active = true,
}: {
  initial: PaymentResult;
  active?: boolean;
}) {
  const [settings, setSettings] = useState<PaymentSettings | null>(
    initial.ok ? initial.value : null,
  );
  const [error, setError] = useState<string | undefined>(
    initial.ok ? undefined : initial.error,
  );
  const [busy, setBusy] = useState<Operation | null>(null);
  const [copied, setCopied] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const disconnectTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Serialize foreground refreshes, polling, and changes to the shared wallet so
  // a response from an earlier refresh cannot undo a successful disconnect.
  const perform = useCallback(
    async (request: () => Promise<PaymentResult>, operation?: Operation) => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setBusy(operation ?? "refresh");
      try {
        const result = await request();
        if (!mounted.current) return false;
        setNow(Date.now());
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setSettings(result.value);
        setError(undefined);
        return true;
      } catch {
        if (mounted.current)
          setError("Could not reach Roost. Refresh to try again.");
        return false;
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(null);
      }
    },
    [],
  );

  const refresh = useCallback(
    (manual = false) =>
      perform(
        () => refreshPayments({ data: {} }),
        manual ? "refresh" : undefined,
      ),
    [perform],
  );

  useEffect(() => {
    if (!active) return;
    const foreground = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    foreground();
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [active, refresh]);

  const connection = settings?.connection;
  const connectionExpired = !!connection && connection.expiresAt <= now;
  const waiting =
    (!!connection && !connectionExpired) ||
    settings?.purchases.some((purchase) =>
      ["creating", "awaiting_approval", "approved", "processing"].includes(
        purchase.status,
      ),
    );

  useEffect(() => {
    if (!active || !waiting) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [active, waiting, refresh]);

  async function connect() {
    setCopied(false);
    await perform(() => connectLink({ data: {} }), "connect");
  }

  async function disconnect() {
    if (await perform(() => disconnectLink({ data: {} }), "disconnect")) {
      setDisconnectOpen(false);
      setCopied(false);
    }
  }

  return (
    <section {...stylex.props(styles.section)} aria-labelledby="payments-title">
      <div {...stylex.props(styles.heading)}>
        <h2 id="payments-title" {...stylex.props(styles.title)}>
          Link wallet
        </h2>
        <div {...stylex.props(styles.actions)}>
          <Button disabled={!!busy} onClick={() => void refresh(true)}>
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
          {settings &&
            (!connection || connectionExpired) &&
            !settings.connected && (
              <Button
                disabled={!!busy}
                onClick={() => void connect()}
                xstyle={styles.primary}
              >
                {busy === "connect" ? "Connecting…" : "Connect Link"}
              </Button>
            )}
          {(settings?.connected || connection) && (
            <Button
              ref={disconnectTrigger}
              disabled={!!busy}
              aria-haspopup="dialog"
              onClick={() => setDisconnectOpen(true)}
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>
      <p {...stylex.props(styles.description)}>
        {settings?.connected
          ? settings.email
            ? `Connected as ${settings.email}. Review and approve purchases securely in Link.`
            : "Connected. Review and approve purchases securely in Link."
          : "Connect your Link wallet to let your agents prepare purchases. You review and approve each request in Link before checkout."}
      </p>
      {connection && (
        <div {...stylex.props(styles.device)}>
          {connectionExpired ? (
            <p role="status" {...stylex.props(styles.description)}>
              This connection code expired. Choose Connect Link to get a new
              one.
            </p>
          ) : (
            <>
              <p {...stylex.props(styles.step)}>1. Copy this one-time code.</p>
              <div {...stylex.props(styles.codeRow)}>
                <code {...stylex.props(styles.code)}>
                  {connection.userCode}
                </code>
                <Button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(connection.userCode)
                      .then(() => setCopied(true))
                      .catch(() =>
                        setError("Copy the code manually, then open Link."),
                      );
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </Button>
              </div>
              <p {...stylex.props(styles.step)}>
                2. Open Link and enter your code to connect your wallet.
              </p>
              <a
                href={connection.verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
                {...stylex.props(styles.link)}
              >
                Open Link ↗
              </a>
              <p role="status" {...stylex.props(styles.description)}>
                Waiting for you to finish connecting… Return here when you’re
                done.
              </p>
            </>
          )}
        </div>
      )}
      {error && !disconnectOpen && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      <p {...stylex.props(styles.note)}>
        Shared by all agents on this Roost server. Payment approval is handled
        by Stripe Link.
      </p>
      <div {...stylex.props(styles.purchases)}>
        <h3 {...stylex.props(styles.title)}>Recent purchases</h3>
        {settings && settings.purchases.length === 0 && (
          <p {...stylex.props(styles.description)}>
            No purchases yet. Ask an agent to help you buy something, then
            review its payment request here or in the conversation.
          </p>
        )}
        {settings && settings.purchases.length > 0 && (
          <ul {...stylex.props(styles.purchaseList)}>
            {settings.purchases.map((purchase) => (
              <li key={purchase.id} {...stylex.props(styles.purchase)}>
                <div {...stylex.props(styles.heading)}>
                  <span {...stylex.props(styles.merchant)}>
                    {purchase.merchantName}
                  </span>
                  <span
                    suppressHydrationWarning
                    {...stylex.props(styles.amount)}
                  >
                    {formatAmount(purchase)}
                  </span>
                </div>
                <p {...stylex.props(styles.purchaseDescription)}>
                  {purchase.description}
                </p>
                <div {...stylex.props(styles.heading)}>
                  <div {...stylex.props(styles.meta)}>
                    <span
                      {...stylex.props(
                        ["awaiting_approval", "requires_action"].includes(
                          purchase.status,
                        ) && styles.attention,
                      )}
                    >
                      {statusLabels[purchase.status] ?? "Status unavailable"}
                    </span>
                    <time
                      suppressHydrationWarning
                      dateTime={new Date(purchase.createdAt).toISOString()}
                    >
                      {new Date(purchase.createdAt).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          day: "numeric",
                        },
                      )}
                    </time>
                  </div>
                  {["awaiting_approval", "requires_action"].includes(
                    purchase.status,
                  ) &&
                    purchase.approvalUrl && (
                      <a
                        href={purchase.approvalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        {...stylex.props(styles.link)}
                      >
                        {purchase.status === "requires_action"
                          ? "Continue in Link ↗"
                          : "Review in Link ↗"}
                      </a>
                    )}
                </div>
                {purchase.error && (
                  <p {...stylex.props(styles.error)}>{purchase.error}</p>
                )}
                {purchase.orderReference && (
                  <p {...stylex.props(styles.note)}>
                    Order {purchase.orderReference}
                  </p>
                )}
                {purchase.receiptUrl && (
                  <a
                    href={purchase.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    {...stylex.props(styles.link)}
                  >
                    View receipt ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Sheet
        open={disconnectOpen}
        onOpenChange={(next) => {
          if (busy !== "disconnect") setDisconnectOpen(next);
        }}
      >
        <SheetContent finalFocus={disconnectTrigger}>
          <div {...stylex.props(styles.confirmation)}>
            <SheetTitle {...stylex.props(styles.confirmationTitle)}>
              Disconnect Link?
            </SheetTitle>
            <SheetDescription>
              This disconnects your wallet for all agents on this Roost server.
              You can reconnect it at any time. Disconnecting does not cancel
              orders already placed with a merchant.
            </SheetDescription>
            {error && (
              <p role="alert" {...stylex.props(styles.error)}>
                {error}
              </p>
            )}
            <div {...stylex.props(styles.confirmationActions)}>
              <Button
                disabled={!!busy}
                onClick={() => setDisconnectOpen(false)}
              >
                Keep connected
              </Button>
              <Button disabled={!!busy} onClick={() => void disconnect()}>
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect Link"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

const styles = stylex.create({
  section: { marginBlock: 28, overflowWrap: "anywhere" },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  title: { fontSize: 14, fontWeight: 500, margin: 0 },
  description: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.6,
    marginBlock: 10,
  },
  note: { color: colors.muted, fontSize: 11, lineHeight: 1.6, marginBottom: 0 },
  primary: {
    backgroundColor: colors.accent,
    color: colors.onAccent,
    paddingInline: 12,
    opacity: { default: 1, ":disabled": 0.5 },
  },
  device: {
    marginBlock: 18,
    padding: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 10,
  },
  step: { fontSize: 12, lineHeight: 1.6, marginTop: 0, marginBottom: 12 },
  codeRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  },
  code: { fontSize: 24, letterSpacing: 2, fontWeight: 500, userSelect: "all" },
  actions: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 },
  link: {
    display: "inline-flex",
    alignItems: "center",
    color: colors.accent,
    fontSize: 12,
    minHeight: { default: 28, "@media (max-width: 700px)": 44 },
    textUnderlineOffset: 4,
  },
  error: { color: colors.foreground, fontSize: 12, lineHeight: 1.6 },
  purchases: { marginTop: 32 },
  purchaseList: { margin: 0, marginTop: 8, padding: 0, listStyleType: "none" },
  purchase: {
    paddingBlock: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  merchant: { fontSize: 13, fontWeight: 500 },
  amount: { fontSize: 13, fontVariantNumeric: "tabular-nums" },
  purchaseDescription: { fontSize: 12, lineHeight: 1.6, marginBlock: 8 },
  meta: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    color: colors.muted,
    fontSize: 11,
  },
  attention: { color: colors.review },
  confirmation: { padding: 24, overflowY: "auto", overflowWrap: "anywhere" },
  confirmationTitle: { fontSize: 20, fontWeight: 500, margin: 0 },
  confirmationActions: {
    display: "flex",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 24,
  },
});
