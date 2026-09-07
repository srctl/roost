# PWA startup

Measured with an isolated production build and Chromium at 390 × 844, using an empty conversation fixture. Cold runs disabled the browser cache and bypassed the service worker to apply the same 150 ms latency, 200,000 bytes/second download rate, and 4× CPU slowdown to both builds. Values are medians of three runs. No production conversations or signed-in desktop were used.

| Measurement                           |        Before |         After |
| ------------------------------------- | ------------: | ------------: |
| First conversation snapshot received  |      4,108 ms |      1,731 ms |
| Composer added to the page            |      3,919 ms |        367 ms |
| JavaScript transferred during startup | 620,378 bytes | 180,920 bytes |
| JavaScript decoded during startup     | 620,378 bytes | 621,529 bytes |

The first row includes loading and hydrating the app, restoring the remembered agent, and receiving its initial run/history state. The second is only the appearance of server-rendered markup; it is not a claim that JavaScript is ready at 367 ms. These are local simulated observations, not physical iPhone measurements or latency percentiles. Real results depend on the server, network, browser, existing HTTP compression, and conversation size.

## Changes

- A cookie containing only the last visited agent ID lets the server redirect a full-page launch to that conversation before downloading and hydrating the home page. The ID must still match an existing agent. In-app Home navigation, explicit deep links, unavailable storage, and missing agents retain their existing behavior. Existing local-storage preferences migrate when the agent is next visited.
- Production builds now generate compressed static assets, served with the matching `Content-Encoding` and `Vary: Accept-Encoding`. Most of the transfer reduction comes from compression; decoded JavaScript is approximately unchanged after including attachments, approvals, and optional dashboard support.
- Agent identity settings load when their sheet opens. The conversation no longer downloads that settings editor at launch.
- The service worker caches only same-origin, hashed immutable build assets. It refuses redirected, private, or non-asset responses and bounds the cache to 64 entries. Documents, conversations, attachments, API responses, and authentication pages never enter the offline cache. Cache failures fall back to network access.
- Supported browsers use navigation preload to overlap the document request with service-worker startup. Offline launches still show the reconnect page, and updates never force-reload an open conversation.

The core cache and offline behavior is covered by `tests/service-worker.test.ts`. The earlier history pagination and large-tool-output improvements are documented in [chat-performance.md](./chat-performance.md).

Browser checks also verified that a fresh production PWA profile retained only 15 hashed assets, transferred no static-asset bytes on repeat launches, displayed the reconnect page offline, and recovered on reconnect. Home navigation, remembered-agent launches, explicit agent links, and opening the deferred settings editor were exercised separately. The mobile layout checks used Chromium emulation; physical iPhone keyboard and installed-PWA behavior still need device verification.
