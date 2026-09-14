import { Switch } from "@base-ui/react/switch";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import {
  changeNotificationPreferences,
  disablePush,
  enablePush,
  getPushSettings,
} from "../features/notifications/functions";
import type { NotificationPreferences } from "../features/notifications/schema";
import { colors } from "../styles/tokens.stylex";
import { Button } from "./ui/button";

const connectionError = "Could not reach Roost. Please try again.";
const notificationOptions = [
  {
    key: "enabled",
    label: "Notifications enabled",
    description: "Pause all notifications without losing your settings.",
  },
  {
    key: "turnCompleted",
    label: "Turn completed",
    description: "A summary of what your agent finished.",
  },
  {
    key: "agentUpdates",
    label: "Agent updates",
    description:
      "Deliveries, tracked changes, and other updates from your agents.",
  },
  {
    key: "needsAttention",
    label: "Needs attention",
    description: "When work fails or your agent needs approval to continue.",
  },
] as const;

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

export function PushNotifications({
  initial,
}: {
  initial: Awaited<ReturnType<typeof getPushSettings>>;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const publicKey = initial.ok ? initial.value.publicKey : null;
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const setupRequired = initial.ok && !initial.value.configured;
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(
      initial.ok ? initial.value.preferences : null,
    );
  const [error, setError] = useState<string | undefined>(
    initial.ok ? undefined : initial.error,
  );

  useEffect(() => {
    let current = true;
    async function load() {
      const reason = unsupportedReason();
      try {
        let deviceError: string | null = null;
        const subscription = reason
          ? undefined
          : await navigator.serviceWorker
              .getRegistration("/")
              .then((registration) =>
                registration?.pushManager.getSubscription(),
              )
              .catch(() => {
                deviceError =
                  "Could not check this device’s notifications. Reload Roost to try again.";
                return undefined;
              });
        // The saved toggles are already rendered. Only this browser's push
        // subscription needs a client-side check; never overwrite preferences
        // here after the user has started editing them.
        const result = subscription
          ? await getPushSettings({ data: { endpoint: subscription.endpoint } })
          : null;
        if (!current) return;
        if (result && !result.ok) throw new Error(result.error);
        setEnabled(
          !!subscription &&
            !!result?.ok &&
            result.value.registered &&
            Notification.permission === "granted",
        );
        if (reason || deviceError) setUnavailable(reason || deviceError);
        else if (setupRequired)
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
  }, [setupRequired]);

  async function changePreference(
    key: keyof NotificationPreferences,
    value: boolean,
  ) {
    if (busy || !preferences) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await changeNotificationPreferences({
        data: { [key]: value },
      });
      if (!result.ok) throw new Error(result.error);
      setPreferences(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : connectionError);
    } finally {
      setBusy(false);
    }
  }

  async function enable() {
    if (busy || !publicKey || !preferences?.enabled) return;
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

  function deviceDescription() {
    if (loading) return "Checking this device’s notification permission…";
    if (unavailable) return unavailable;
    if (!preferences)
      return "Notification settings could not be loaded. Reload Roost to try again.";
    if (!preferences.enabled)
      return enabled
        ? "This device is enabled. Notifications are paused for all devices."
        : "Notifications are paused for all devices. Turn them on above to enable this device.";
    return enabled
      ? "Enabled on this device. Your selected notifications can arrive even when Roost is closed."
      : "Enable this device to receive your selected notifications, even when Roost is closed.";
  }

  return (
    <section {...stylex.props(styles.section)} aria-labelledby="push-title">
      <h2 id="push-title" {...stylex.props(styles.title)}>
        Notifications
      </h2>
      <p {...stylex.props(styles.description)}>
        Choose which updates you receive. These settings apply to all your
        devices.
      </p>
      <div {...stylex.props(styles.preferences)} aria-busy={busy}>
        {notificationOptions.map(({ key, label, description }) => {
          const checked = preferences?.[key] ?? false;
          const disabled =
            busy || !preferences || (key !== "enabled" && !preferences.enabled);
          return (
            <div key={key} {...stylex.props(styles.row)}>
              <div>
                <label
                  htmlFor={`notifications-${key}`}
                  {...stylex.props(styles.label)}
                >
                  {label}
                </label>
                <p
                  id={`notifications-${key}-description`}
                  {...stylex.props(styles.optionDescription)}
                >
                  {description}
                </p>
              </div>
              <Switch.Root
                id={`notifications-${key}`}
                aria-label={label}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => void changePreference(key, value)}
                aria-describedby={`notifications-${key}-description`}
                {...stylex.props(
                  styles.switch,
                  checked && styles.checked,
                  disabled && styles.disabled,
                )}
              >
                <Switch.Thumb
                  {...stylex.props(
                    styles.thumb,
                    checked && styles.thumbChecked,
                  )}
                />
              </Switch.Root>
            </div>
          );
        })}
      </div>
      <div {...stylex.props(styles.preview)}>
        <span {...stylex.props(styles.example)}>Example notification</span>
        <p {...stylex.props(styles.previewTitle)}>Shoppy · Package delivered</p>
        <p {...stylex.props(styles.optionDescription)}>
          Your coffee order was delivered at 2:14 PM. The package is at your
          front door.
        </p>
      </div>
      <p {...stylex.props(styles.note)}>
        Tap a notification to open that agent’s conversation. Previews include
        task details and may appear on your lock screen.
      </p>
      <div {...stylex.props(styles.device)}>
        <h3 {...stylex.props(styles.title)}>This device</h3>
        <Button
          disabled={
            loading ||
            busy ||
            (!enabled && (!!unavailable || !publicKey || !preferences?.enabled))
          }
          onClick={() => void (enabled ? disable() : enable())}
        >
          {loading
            ? "Checking this device…"
            : busy
              ? "Updating…"
              : enabled
                ? "Disable on this device"
                : "Enable on this device"}
        </Button>
      </div>
      <p {...stylex.props(styles.description)}>{deviceDescription()}</p>
      {setupRequired && (
        <p {...stylex.props(styles.note)}>
          <a
            href="https://github.com/srctl/roost/blob/main/docs/notifications.md"
            target="_blank"
            rel="noopener noreferrer"
            {...stylex.props(styles.link)}
          >
            Notification setup guide ↗
          </a>
        </p>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
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
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
  },
  preferences: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    marginTop: 20,
  },
  device: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 24,
  },
  title: { fontSize: 14, fontWeight: 500, margin: 0 },
  label: { fontSize: 13, fontWeight: 500, cursor: "pointer" },
  optionDescription: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.6,
    marginTop: 3,
    marginBottom: 0,
    maxWidth: 380,
  },
  description: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 1.6,
    marginBlock: 10,
  },
  note: { color: colors.muted, fontSize: 11, lineHeight: 1.6, marginBottom: 0 },
  link: { color: colors.foreground, textUnderlineOffset: 3 },
  error: { color: colors.review, fontSize: 12, lineHeight: 1.6 },
  preview: {
    marginTop: 24,
    padding: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: colors.border,
    borderRadius: 8,
  },
  example: { color: colors.muted, fontSize: 11 },
  previewTitle: {
    fontSize: 13,
    fontWeight: 500,
    marginTop: 8,
    marginBottom: 0,
  },
  switch: {
    width: 36,
    height: 22,
    borderWidth: 0,
    borderRadius: 20,
    padding: 3,
    backgroundColor: colors.bubble,
    cursor: "pointer",
    flexShrink: 0,
    display: "flex",
    outlineOffset: 3,
  },
  checked: { backgroundColor: colors.accent },
  disabled: { opacity: 0.45, cursor: "default" },
  thumb: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    backgroundColor: colors.foreground,
    transform: "translateX(0)",
  },
  thumbChecked: {
    transform: "translateX(14px)",
    backgroundColor: colors.onAccent,
  },
});
