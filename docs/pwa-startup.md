# PWA startup

## Initial compression and cache improvements

Measured with an isolated production build and Chromium at 390 × 844, using an empty conversation fixture. Cold runs disabled the browser cache and bypassed the service worker to apply the same 150 ms latency, 200,000 bytes/second download rate, and 4× CPU slowdown to both builds. Values are medians of three runs. No production conversations or signed-in desktop were used.

| Measurement                           |        Before |         After |
| ------------------------------------- | ------------: | ------------: |
| First conversation snapshot received  |      4,108 ms |      1,731 ms |
| Composer added to the page            |      3,919 ms |        367 ms |
| JavaScript transferred during startup | 620,378 bytes | 180,920 bytes |
| JavaScript decoded during startup     | 620,378 bytes | 621,529 bytes |

The first row includes loading and hydrating the app, restoring the remembered agent, and receiving its initial run/history state. The second is only the appearance of server-rendered markup; it is not a claim that JavaScript is ready at 367 ms. These are local simulated observations, not physical iPhone measurements or latency percentiles. Real results depend on the server, network, browser, existing HTTP compression, and conversation size.

## Changes

- A cookie containing only the last visited agent ID lets the server redirect a full-page launch to that conversation before downloading and hydrating the home page. The ID must still match an existing agent. In-app Home navigation, explicit deep links, unavailable storage, and missing agents retain their existing behavior. Visiting a conversation or its dashboard updates the cookie; local storage no longer redirects an already rendered page.
- Production builds now generate compressed static assets, served with the matching `Content-Encoding` and `Vary: Accept-Encoding`. Most of the transfer reduction comes from compression; decoded JavaScript is approximately unchanged after including attachments, approvals, and optional dashboard support.
- Agent identity settings load when their sheet opens. The conversation no longer downloads that settings editor at launch.
- The service worker caches only same-origin, hashed immutable build assets. It refuses redirected, private, or non-asset responses and bounds the cache to 64 entries. Documents, conversations, attachments, API responses, and authentication pages never enter the offline cache. Cache failures fall back to network access.
- Supported browsers use navigation preload to overlap the document request with service-worker startup. Offline launches still show the reconnect page, and updates never force-reload an open conversation.

The core cache and offline behavior is covered by `tests/service-worker.test.ts`. The earlier history pagination and large-tool-output improvements are documented in [chat-performance.md](./chat-performance.md).

Browser checks also verified that a fresh production PWA profile retained only 15 hashed assets, transferred no static-asset bytes on repeat launches, displayed the reconnect page offline, and recovered on reconnect. Home navigation, remembered-agent launches, explicit agent links, and opening the deferred settings editor were exercised separately. The mobile layout checks used Chromium emulation; physical iPhone keyboard and installed-PWA behavior still need device verification.

## Conversation startup follow-up

A second pass compares the released 0.1.22 build with 0.1.23 under the same throttling. The populated fixture has 20 entries: 10 user messages and 10 assistant replies containing headings, lists, emphasis, code, and links. An identical second agent has an empty conversation. Each number is the median of three launches to `/` with a valid remembered-agent cookie.

Readiness now requires the stored history to be present and a textarea input event to enable the Send button through React. The test does not submit a message. This measures an interactive composer rather than only enabled server-rendered markup.

| Measurement                                                        | Released 0.1.22 | Released 0.1.23 |
| ------------------------------------------------------------------ | --------------: | --------------: |
| Cold populated conversation, history and composer ready            |        1,788 ms |        1,278 ms |
| Cold empty conversation, composer ready                            |        1,707 ms |        1,247 ms |
| Cold populated conversation, formatted history first visible       |        1,788 ms |          450 ms |
| Cold initial static assets transferred (JavaScript, CSS, two SVGs) |   181,969 bytes |   155,795 bytes |
| Warm populated conversation, history and composer ready            |               — |          332 ms |
| Warm empty conversation, composer ready                            |               — |          270 ms |

Warm launches enable both the browser cache and the service worker after priming the page; static-resource network transfer was zero in each run. The cold result is about 1.3 seconds under these simulated conditions, not a claim of a universal one-second startup. The warm figures do not represent a first visit.

Version 0.1.23:

- Reads the latest 60 stored timeline entries during server rendering and initializes the existing conversation hook from that snapshot. The first background poll requests revisions after the snapshot, so it does not block the composer. Legacy Codex history imports stay in the client fallback and never block server rendering.
- Compresses HTML as a stream, preserving private/no-store headers. The populated fixture document was about 28 KB uncompressed and 6 KB over gzip, including formatted history and its bootstrap data.
- Loads closed navigation, agent settings, and notice detail panels when opened. Markdown remains in the initial dependency graph so formatted replies never disappear during hydration.
- Preloads the full static dependency chain of the active route. Dynamic imports remain deferred; required Markdown and shared UI dependencies no longer wait for a later network round trip.
- Resolves the ordinary remembered-agent launch on the server and sets the canonical conversation URL before hydration. Query-bearing launches and redirects that change cookies keep ordinary redirect behavior. In-app Home navigation, browser back/forward, reloads, hashes, stale cookies, and explicit deep links were checked separately.

Browser regression checks applied a timeline update after the document response began and before hydration finished. All 10 formatted replies stayed visible, the background poll applied the update, and typed text enabled Send. Deferred navigation/settings/approval panels opened correctly and restored trigger focus when closed. No production data or physical iPhone was used. Snapshot bounds, legacy fallback, compression/cancellation, static-preload traversal, and guarded startup routing have focused regression tests.

## Refresh layout

Conversation response style and activity-detail preferences now use cookies so
server-rendered messages match the hydrated view. Existing local-storage display
preferences migrate once on the first upgraded visit; subsequent requests render
them directly. Dashboard tabs and computer availability are included in the root
loader instead of appearing after an idle-time request.

Conversation history starts at the latest message as the document is parsed and
continues following replies during hydration. It manages its own scrolling rather
than restoring a router position calculated against an older message layout.
Explicit conversation and dashboard URLs always take precedence over the
remembered-agent cookie, which is used only for full-page Home launches.

The Settings route also loads Codex connection status and notification preferences
on the server. Saved toggles are usable independently of the browser's push
subscription check, whose delayed result cannot overwrite a newer setting edit.
Device-specific notification permission remains a browser check with an explicit
checking state.
