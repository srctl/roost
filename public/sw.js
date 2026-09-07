// Cache only immutable build assets. Authenticated pages, API responses, and
// agent data always use the network; an open conversation is never reloaded.
const assetCache = "roost-assets-v1";
const assetLimit = 64;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      self.registration.navigationPreload?.enable().catch(() => {}),
    ]),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (
    url.origin === self.location.origin &&
    !url.search &&
    /^\/assets\/[^/]+-[\w-]{8,}\.(?:js|css|svg|png|webp|woff2?)$/.test(
      url.pathname,
    )
  ) {
    event.respondWith(loadAsset(event));
    return;
  }
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => (await event.preloadResponse) ?? fetch(event.request))().catch(
      () =>
        new Response(
          `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#20221E">
<title>Roost · Offline</title>
<style>
html{background:#20221e;color:#eceee8;color-scheme:dark;font:16px/1.5 system-ui}
body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
main{max-width:320px}h1{font-size:24px}p{color:#a3a79b}a{color:#dce4cf}
</style></head><body><main><h1>You're offline</h1>
<p>Reconnect to open Roost. Your agents run on the server.</p>
<a href="">Try again</a></main></body></html>`,
          {
            status: 503,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          },
        ),
    ),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    // Still show a visible notification when a payload cannot be decoded.
  }
  event.waitUntil(
    self.registration.showNotification(
      typeof payload.title === "string" && payload.title.trim()
        ? payload.title.slice(0, 100)
        : "Roost",
      {
        body:
          typeof payload.body === "string"
            ? payload.body.slice(0, 240)
            : "An agent has an update for you.",
        icon: "/icons/roost-192.png",
        tag:
          typeof payload.tag === "string" ? payload.tag.slice(0, 200) : "roost",
        data: { url: payload.url },
      },
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let url = new URL("/", self.location.origin);
  try {
    const target = new URL(event.notification.data?.url, self.location.origin);
    if (
      target.origin === self.location.origin &&
      /^\/agents\/[0-9a-f-]{36}$/i.test(target.pathname) &&
      !target.search &&
      !target.hash
    )
      url = target;
  } catch {
    // Only Roost conversation links may be opened from notifications.
  }
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find((client) => client.url === url.href);
        if (existing) return existing.focus();
        return self.clients.openWindow(url.href);
      }),
  );
});

async function loadAsset(event) {
  const cache = await caches.open(assetCache).catch(() => null);
  const saved = await cache?.match(event.request).catch(() => null);
  if (saved) return saved;
  const response = await fetch(event.request);
  if (
    cache &&
    response.status === 200 &&
    !response.redirected &&
    /\bimmutable\b/i.test(response.headers.get("Cache-Control") ?? "") &&
    !/\b(?:private|no-store)\b/i.test(
      response.headers.get("Cache-Control") ?? "",
    ) &&
    /^(?:text\/(?:javascript|css)|application\/javascript|image\/|font\/)/i.test(
      response.headers.get("Content-Type") ?? "",
    )
  ) {
    const copy = response.clone();
    event.waitUntil(
      (async () => {
        await cache.put(event.request, copy);
        const keys = await cache.keys();
        await Promise.all(
          keys.slice(0, -assetLimit).map((key) => cache.delete(key)),
        );
      })().catch(() => {}),
    );
  }
  return response;
}
