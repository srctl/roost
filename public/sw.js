// Keep authenticated pages, API responses, and agent data out of offline caches.
// New releases are fetched normally; an open conversation is never force-reloaded.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET")
    return;
  event.respondWith(
    fetch(event.request).catch(
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
