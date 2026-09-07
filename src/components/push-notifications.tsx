import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushSettings,
} from "../features/notifications/functions";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

const connectionError = "Could not reach Roost. Please try again.";

function unsupportedReason() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone;
  if (ios && !standalone)
    return "On iPhone or iPad, add Roost to your Home Screen, open it there, then enable notifications.";
  if (!window.isSecureContext)
    return "Open Roost over HTTPS to enable notifications.";
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    return "This browser does not support push notifications.";
  return null;
}

function decodeKey(value: string) {
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (character) => character.charCodeAt(0),
  );
}

async function activeRegistration() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Notifications could not start. Reload Roost and try again.",
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

export function PushNotifications() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    async function load() {
      const reason = unsupportedReason();
      if (reason) {
        setUnavailable(reason);
        setLoading(false);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = await registration?.pushManager.getSubscription();
        const result = await getPushSettings({
          data: { endpoint: subscription?.endpoint },
        });
        if (!current) return;
        if (!result.ok) throw new Error(result.error);
        setPublicKey(result.value.publicKey);
        setSetupRequired(!result.value.configured);
        setEnabled(
          !!subscription &&
            result.value.registered &&
            Notification.permission === "granted",
        );
        if (!result.value.configured)
          setUnavailable(
            "Notifications need to be configured on this Roost server. See the notification setup guide.",
          );
        else if (Notification.permission === "denied")
          setUnavailable(
            "Notifications are blocked. Allow them in your browser or device settings, then reload Roost.",
          );
      } catch (cause) {
        if (current)
          setError(cause instanceof Error ? cause.message : connectionError);
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, []);

  async function enable() {
    if (busy || !publicKey) return;
    setBusy(true);
    setError(undefined);
    let created: PushSubscription | null = null;
    try {
      // Keep the permission prompt in the button gesture, before network awaits.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setUnavailable(
          permission === "denied"
            ? "Notifications are blocked. Allow them in your browser or device settings, then reload Roost."
            : null,
        );
        if (permission === "default")
          setError(
            "Notifications weren’t enabled. Try again when you’re ready.",
          );
        return;
      }
      const registration = await activeRegistration();
      let subscription = await registration.pushManager.getSubscription();
      const key = decodeKey(publicKey);
      const existingKey = subscription?.options.applicationServerKey;
      if (
        subscription &&
        (!existingKey ||
          !key.every(
            (byte, index) => byte === new Uint8Array(existingKey)[index],
          ) ||
          key.length !== existingKey.byteLength)
      ) {
        const removed = await disablePush({
          data: { endpoint: subscription.endpoint },
        });
        if (!removed.ok) throw new Error(removed.error);
        await subscription.unsubscribe();
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        created = subscription;
      }
      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys.auth)
        throw new Error(
          "This browser could not create a notification subscription.",
        );
      const saved = await enablePush({
        data: {
          endpoint: subscription.endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          publicKey,
        },
      });
      if (!saved.ok) throw new Error(saved.error);
      setEnabled(true);
      setUnavailable(null);
    } catch (cause) {
      await created?.unsubscribe().catch(() => {});
      setError(cause instanceof Error ? cause.message : connectionError);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const removed = await disablePush({
          data: { endpoint: subscription.endpoint },
        });
        if (!removed.ok) throw new Error(removed.error);
        // Removing the server record stops delivery even if the browser is offline.
        await subscription.unsubscribe().catch(() => {});
      }
      setEnabled(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : connectionError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section {...stylex.props(styles.section)} aria-labelledby="push-title">
      <div {...stylex.props(styles.heading)}>
        <h2 id="push-title" {...stylex.props(styles.title)}>
          Notifications
        </h2>
        <Button
          disabled={
            loading || busy || (!enabled && (!!unavailable || !publicKey))
          }
          onClick={() => void (enabled ? disable() : enable())}
        >
          {busy
            ? "Updating…"
            : enabled
              ? "Disable on this device"
              : "Enable on this device"}
        </Button>
      </div>
      <p {...stylex.props(styles.description)}>
        {loading
          ? "Checking notification settings…"
          : (unavailable ??
            (enabled
              ? "Enabled on this device. Roost will notify you when work finishes, fails, or needs approval."
              : "Get notified when work finishes, fails, or needs your approval, even when Roost is closed."))}
      </p>
      <p {...stylex.props(styles.note)}>
        Notification previews keep conversation content private.
        {setupRequired && (
          <>
            {" "}
            <a
              href="https://github.com/srctl/roost/blob/main/docs/notifications.md"
              target="_blank"
              rel="noopener noreferrer"
              {...stylex.props(styles.link)}
            >
              Setup guide ↗
            </a>
          </>
        )}
      </p>
      {error && (
        <p role="alert" {...stylex.props(styles.description)}>
          {error}
        </p>
      )}
    </section>
  );
}

const styles = stylex.create({
  section: {
    marginBlock: 28,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
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
  note: { color: colors.muted, fontSize: 11, marginBottom: 0 },
  link: { color: colors.foreground, textUnderlineOffset: 3 },
});
