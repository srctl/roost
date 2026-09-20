import * as stylex from "@stylexjs/stylex";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  getPaymentSettings,
  refreshPayments,
} from "../features/payments/functions";
import type { PaymentPurchase } from "../features/payments/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

function pending(purchase: PaymentPurchase) {
  return [
    "creating",
    "awaiting_approval",
    "approved",
    "processing",
    "requires_action",
  ].includes(purchase.status);
}

export function PaymentRequests({
  agentId,
  busy = false,
  id,
}: {
  agentId: string;
  busy?: boolean;
  id?: string;
}) {
  const [purchases, setPurchases] = useState<PaymentPurchase[]>([]);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => {
    let canceled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    let hasPending = false;

    async function load(provider = false) {
      if (inFlight || canceled) return;
      inFlight = true;
      clearTimeout(timer);
      if (provider) setRefreshing(true);
      try {
        const result = await (provider ? refreshPayments : getPaymentSettings)({
          data: { agentId },
        });
        if (canceled) return;
        if (result.ok) {
          const next = result.value.purchases.filter((purchase) =>
            id ? purchase.id === id : pending(purchase),
          );
          hasPending = next.some(
            (purchase) =>
              pending(purchase) && purchase.status !== "requires_action",
          );
          setPurchases(next);
          setError(undefined);
        } else setError(result.error);
      } catch {
        if (!canceled)
          setError("Could not check payment requests. Refresh to try again.");
      } finally {
        inFlight = false;
        if (!canceled) {
          setRefreshing(false);
          if (busy || hasPending) timer = setTimeout(() => void load(), 3000);
        }
      }
    }

    function foreground() {
      if (document.visibilityState === "visible") void load(true);
    }

    refresh.current = () => void load(true);
    void load();
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      canceled = true;
      clearTimeout(timer);
      refresh.current = () => {};
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [agentId, busy, id]);

  if (!purchases.length && !id) return null;

  return (
    <div aria-live="polite" {...stylex.props(styles.list)}>
      {purchases.map((purchase) => (
        <section
          key={purchase.id}
          aria-label="Link payment request"
          {...stylex.props(styles.card)}
        >
          <div {...stylex.props(styles.heading)}>
            <strong>{purchase.merchantName}</strong>
            <span {...stylex.props(styles.amount)}>
              {new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: purchase.currency,
              }).format(purchase.amount / 100)}
            </span>
          </div>
          <p {...stylex.props(styles.description)}>{purchase.description}</p>
          <div {...stylex.props(styles.actions)}>
            {["awaiting_approval", "requires_action"].includes(
              purchase.status,
            ) && purchase.approvalUrl ? (
              <a
                href={purchase.approvalUrl}
                target="_blank"
                rel="noopener noreferrer"
                {...stylex.props(styles.approval)}
              >
                {purchase.status === "requires_action"
                  ? "Continue in Link ↗"
                  : "Review and approve in Link ↗"}
              </a>
            ) : (
              <span {...stylex.props(styles.status)}>
                {purchase.status === "creating"
                  ? "Preparing payment request…"
                  : purchase.status === "approved"
                    ? "Approved in Link · checkout pending"
                    : purchase.status === "awaiting_approval"
                      ? "Awaiting your approval in Link"
                      : purchase.status === "requires_action"
                        ? "Action needed in Link"
                        : purchase.status === "processing"
                          ? "Processing payment…"
                          : purchase.status === "unknown"
                            ? "Payment status unavailable"
                            : purchase.status.charAt(0).toUpperCase() +
                              purchase.status.slice(1)}
              </span>
            )}
            <Button disabled={refreshing} onClick={() => refresh.current()}>
              {refreshing ? "Checking…" : "Check status"}
            </Button>
          </div>
          {purchase.status === "awaiting_approval" && (
            <p {...stylex.props(styles.note)}>
              Review the merchant and total in Link. Your agent will continue
              after approval.
            </p>
          )}
          {purchase.error && (
            <p {...stylex.props(styles.description)}>{purchase.error}</p>
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
        </section>
      ))}
      {error && (
        <p role="alert" {...stylex.props(styles.description)}>
          {error}
        </p>
      )}
      {!!id && purchases.length === 0 && (
        <p {...stylex.props(styles.description)}>No payment request found.</p>
      )}
      <Link
        to="/settings"
        search={{ group: "payments" }}
        {...stylex.props(styles.link)}
      >
        Payment settings
      </Link>
    </div>
  );
}

const styles = stylex.create({
  list: { flexShrink: 0, maxHeight: "35vh", overflowY: "auto" },
  card: {
    marginBlock: 8,
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
    fontSize: 12,
    overflowWrap: "anywhere",
  },
  heading: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  amount: { fontVariantNumeric: "tabular-nums" },
  description: { fontSize: 12, lineHeight: 1.6, marginBlock: 8 },
  actions: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 },
  approval: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: { default: 32, "@media (max-width: 700px)": 44 },
    paddingInline: 12,
    backgroundColor: colors.accent,
    color: colors.onAccent,
    borderRadius: 5,
    textDecoration: "none",
  },
  status: { color: colors.muted, lineHeight: 1.6 },
  note: { fontSize: 11, color: colors.muted, lineHeight: 1.6, marginBottom: 0 },
  link: {
    display: "inline-flex",
    alignItems: "center",
    color: colors.accent,
    fontSize: 12,
    minHeight: { default: 28, "@media (max-width: 700px)": 44 },
    textUnderlineOffset: 4,
  },
});
