# Push notifications

In **Settings → Notifications**, choose **Enable on this device** and allow the
browser permission prompt. Each browser or installed PWA subscribes separately.
Disable notifications in the same place to stop delivery to that device.

Roost sends a notification when a conversation or scheduled task finishes,
fails, or requests approval. Quiet automations that return `ROOST_NO_UPDATE`
stay quiet. Cancelled runs and intermediate specialist delegations do not send
completion notifications. Notification previews contain only a generic status,
never agent names, prompts, responses, or approval details. Tapping one opens
the agent's conversation; it does not approve anything.

## Server setup

For a source installation, set a contact address for your push sender before starting Roost:

```sh
ROOST_PUSH_SUBJECT=mailto:you@example.com corepack pnpm start
```

For a packaged systemd installation, add the setting to the service instead of
only exporting it in your terminal:

```sh
sudo systemctl edit roost-$(id -u).service
```

Add this drop-in, replacing the example with your contact address:

```ini
[Service]
Environment="ROOST_PUSH_SUBJECT=mailto:you@example.com"
```

Wait for active work to finish, then run `roost server stop` followed by
`roost server start` to apply the service environment. Stopping interrupts
active runs; changing the setting itself does not.

An HTTPS contact page is also accepted. This identifies your Roost installation
to browser push services; it is not an email delivery address. Use your own
contact information. A missing or invalid setting disables notification setup.

Roost generates its VAPID signing keys once in
`$ROOST_DATA_DIR/notifications/vapid.json` (`.roost/notifications/vapid.json` by
default), with private directory/file permissions. Keep this file with your
data backups and do not publish it. Browser subscriptions are stored in the
Roost database. Losing the signing keys requires devices to disable and enable
notifications again. Only the public key is sent to the browser.

The browser needs a secure context: HTTPS for remote access, or localhost during
development. Keep Roost behind the same authenticated private proxy you use for
remote access; push adds no public inbound endpoint. On iPhone and iPad, add
Roost to the Home Screen and enable notifications from the installed app.
Permission is requested only when you press the enable button. If notifications
were blocked, change the browser/device permission, reload Roost, and enable
them again.

The server needs outbound HTTPS access to the browser's push provider. Roost
currently accepts Google FCM, Mozilla, Apple Web Push, and Windows notification
endpoints. Other endpoint hosts are rejected to prevent arbitrary outbound
requests. No Firebase project or paid notification service is required.

## Delivery behavior

Roost and its host must remain running to finish work and send notifications.
The browser/PWA can be closed. Delivery is best effort: server failures never
fail agent work, missed sends are not retried, and the push service retains a
sent notification for up to one hour. Device permissions, Focus modes, network
access, and the operating system can delay or prevent display. Check the
conversation for the durable result or pending approval.

Expired subscriptions (provider HTTP 404/410) are removed automatically.
Transient delivery failures keep the subscription for the next update and log
only a generic message, without subscription URLs, keys, or provider responses.
If a browser rotates or loses its subscription, enable notifications again in
Settings. Subscriptions are limited to 32 devices per installation.

Implementation references: [Web Push library](https://github.com/web-push-libs/web-push),
[browser subscription API](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe),
and [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
