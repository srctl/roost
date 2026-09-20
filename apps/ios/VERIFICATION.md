# Native iPhone verification

Verified from this working tree on September 19, 2026, using Xcode 16.4,
iOS 18.6 and an iPhone 16 Pro simulator. Tests use disposable local data and
test-only credentials. They do not send real messages, purchase items, sign into
Codex, deliver Apple notifications, or control a real desktop.

## What changed

| Area | Native behavior |
| --- | --- |
| Images | Authenticated inline thumbnails, Photos and file import, composer preview, full-size Quick Look and sharing. Bounded memory cache and off-main-thread image decoding. |
| Conversations | Richer Markdown, accessible activity disclosure, attachment-only follow-ups, reliable send acknowledgement and retry, draft recovery, and session isolation. |
| Agents | Create, rename, delete, shared sections and ordering, soul/history/undo, memories, reflection preferences, coding settings and execution profiles. |
| Automations | Create/edit schedules, preview next runs, pause/resume, manual runs, history/output, cancellation and revision conflict handling. |
| Computer | Live desktop, take/return control, text and special keys, background disconnect and foreground reconnect. Device credentials stay outside WebKit. |
| Settings | Shared notification/dashboard preferences, local activity display, Codex device-code sign-in, browser security settings and token replacement. |
| Notifications | Device-bound APNs registration, explicit permission, category preferences, revocation, and validated agent/reply-thread routing. |

Existing Feed, payments, notes, dashboards, coding jobs, reply threads, themes,
approval and motion flows remain part of the regression suite.

Verification found and fixed a crash when confirming an agent deletion, an
observable-state mutation during navigation, a detached desktop renderer after
foregrounding, gaps in row touch targets, and missing labels on populated coding
fields. Session changes now retire pending sends and image downloads so delayed
responses cannot restore old drafts or refill a cleared image cache.

## Automated evidence

- Web: 346 tests passed, including native endpoint authentication, revision and
  ownership checks, scheduling and notification delivery behavior.
- APNs: 24 focused notification tests passed with generated temporary keys and a
  mock provider. They cover ES256 authentication, registration scope, shared
  preferences, provider errors, invalid registrations and stale responses.
- Production mobile smoke: bearer authentication, shared settings/native push
  status, payments, browser isolation, origin rejection and revocation passed.
- Production desktop smoke: binary traffic in both directions, one-use tickets,
  device/control ownership, browser rejection and live revocation passed.
- TypeScript typecheck and production server/CLI builds passed.
- Web/PWA image previews passed browser flows at 1440, 390 and 320 pixels:
  inline decoding, upload/composer previews, full-image dialog, Escape and focus
  restoration, actual document download, failed-image fallback and recovery,
  no remote-image request and no horizontal overflow. The production browser test
  uses a separate disposable store and port:
  `corepack pnpm --filter @roost/web exec node --import tsx tests/browser/images.ts`.
- Existing web conversation/reply-thread browser regressions passed for both
  message formats across desktop, mobile, narrow-touch and desktop-touch layouts.
  Desktop/mobile persistence checks include drafts, attachment reload, focus,
  history anchors, unread state, thread isolation, streaming and queue/cancel.
- Native: all 64 unit tests passed, including delayed send/session invalidation,
  image downsampling/cache invalidation, reconnect cancellation, APNs registration
  ordering, rich Notes, scheduling and payment decoding. Feed tests also cover
  chronological time sections, local midnight, daylight-saving changes and
  restoring a dismissed story after a background refresh.
- The final iOS device Release build passed with signing disabled. Strict Swift
  formatting, changed image-file Biome checks, project-generator determinism and
  `git diff --check` passed.
- All 13 native UI flows passed across the full regression and focused follow-ups:
  agent creation/sections/deletion; identity/reflections; automations; Codex
  connection; coding settings/profiles; desktop control/reconnect; Feed;
  image upload/preview; notifications; payments; conversation/replies/approvals/
  themes/retry/motion; display settings; and shared Notes/dashboard/coding workspaces.

Local XCTest evidence (retained under `/private/tmp`):

| Result bundle | Verified coverage |
| --- | --- |
| `roost-native-final-3.xcresult` | 56 unit tests and 10 UI flows passed. Three remaining UI failures led to the accessibility, touch-target and test-readiness fixes verified below. Desktop assertions check actual rendered pixels after two foreground transitions; deletion asserts cancel, confirm and continued navigation. |
| `roost-native-focused-4.xcresult` | All 57 unit tests, image UI and conversation UI passed. Conversation checks assert exactly one server message and one stable rendered message after normal send, interrupted delivery/retry and reduced-motion send. Coding-row and Notes-menu checks were completed in the next two bundles. |
| `roost-native-coding-5.xcresult` | Coding settings/profile UI passed: persisted repository/instructions after relaunch, create/open/edit profile, and saved revision. |
| `roost-native-workspace-6.xcresult` | Shared Notes/dashboard/coding UI passed: chart values, rich editing, autosave, undo/redo, authenticated persistence, revision history, coding workspace, worker send and note relaunch. |
| `roost-native-feed-followup-9.xcresult` | All 64 unit tests and the updated Feed UI passed: All/Saved only, decoded landscape photos in row/reader, rotation bounds, saved state, preferences, dismiss/restore after refresh and discussion navigation. |

Final release-build log: `/private/tmp/roost-ios-release-final.log`.
The subsequent Feed release build also passed: `/private/tmp/roost-ios-feed-release-final.log`.
The temporary mobile and desktop fixture servers were stopped after verification.

The Feed follow-up removes read/unread controls and automatic read marking, groups
stories by local publishing time, and keeps fuller summaries with landscape images.
Personal/email updates do not load images. Restoring a dismissed story now also
reinserts it locally if a background refresh removed it from the current snapshot.
The fixture photograph and screenshot crop are credited in the
[screenshot record](screenshots/README.md#feed-time-groups-and-images--september-19-2026).

## Screenshots

- [Feed grouped by publishing time](screenshots/feed-time-groups-native.png)
- [Feed reader with a landscape photo](screenshots/feed-story-photo-native.png)
- [Feed reader after rotation](screenshots/feed-landscape-photo-native.png)
- [Image in a conversation](screenshots/image-message-native.png)
- [Photo ready to send](screenshots/image-composer-native.png)
- [Full-screen image](screenshots/image-fullscreen-native.png)
- [Desktop and native keyboard](screenshots/computer-control-native.png)
- [Desktop restored after backgrounding](screenshots/computer-reconnected-native.png)
- [Agent sections](screenshots/agent-sections-native.png)
- [Automation details](screenshots/automation-native.png)
- [Display preferences](screenshots/display-preferences-native.png)
- [Saved coding project and execution profile](screenshots/coding-settings-native.png)
- [Verified coding workspace](screenshots/workspace-verified-native.png)
- [Shared Notes and native keyboard](screenshots/notes-verified-native.png)
- [Matching web/PWA image previews](screenshots/image-web-mobile.png)
- [Web/PWA full-image viewer at 320 pixels](screenshots/image-web-viewer.png)

The desktop image is an actual framebuffer rendered through the production
WebSocket route and bundled noVNC renderer in WKWebView. Its patterned content
comes from a local RFB test server.

## Remaining external verification

Apple push delivery needs a signed build with a matching push entitlement,
Apple provider credentials on the server, and a physical-device delivery check.
Provider calls in this verification were mocked. The app clearly reports absent
configuration; no simulated success is shown to users.

Apple signing, TestFlight/App Store distribution, real Codex login, real wallet
purchases, a real remote desktop, physical-device haptics and deployment were not
performed. The running Roost server must include these API changes. Conversation
history is online; drafts have local recovery. Browser passkey/session management
uses its separately authenticated browser flow.

See [setup and reproducible commands](README.md).
