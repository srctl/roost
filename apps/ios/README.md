# Roost for iPhone

A native SwiftUI client for an existing Roost server. Requires iOS 17 or later
and Xcode 16 or later. JuxiSwiftUI is supplied as a pinned local source snapshot
under `packages/juxi-swiftui`; no network package resolution is needed.

Dashboard views now share Juxi plans with the web app while rendering native SwiftUI
components. See [adaptive dashboard configuration and verification](../../docs/juxi.md).
Settings also supports replacing a device token without losing same-server drafts.

[Simulator screenshots and verification](screenshots/README.md).

## Run

Open `Roost.xcodeproj`, select the **Roost** scheme and an iPhone simulator, and
run. For a physical iPhone, choose your Apple development team under Signing &
Capabilities and use a unique bundle identifier if required by your account.
Simulator tests use normal ad-hoc signing; disabling signing also disables the
Keychain entitlement and prevents connection storage.

The server must include the `/api/mobile/v1` endpoints. On the host
running Roost:

```sh
roost mobile create --name iPhone --output ~/iphone-token.txt
```

For a source checkout, run the same CLI against the **same data directory** used
by the web server:

```sh
ROOST_DATA_DIR=/absolute/path/to/data pnpm --filter @roost/web exec node --import tsx src/cli/main.ts mobile create --name iPhone --output /private/path/iphone-token.txt
```

Enter the server's HTTPS origin and the token from that file in the app. The CLI
writes the token once to a new, owner-readable file, never to stdout. Transfer it
privately and remove the transfer file after connecting.

Device tokens grant access to all agents, conversations, files, and approval
responses exposed by the mobile API. They expire after 90 days. Manage them with:

```sh
roost mobile list
roost mobile revoke <device-id>
```

Disconnect in the app revokes its token and removes its connection and drafts.
“Remove saved connection only” works offline; revoke that token on the server
separately. Device tokens are independent of web passkeys and web sessions;
recovering a web passkey does not revoke mobile devices.

The app needs a directly reachable HTTPS endpoint. Browser authentication proxies
(such as an interactive exe.dev login) do not transfer their cookies to this app.
Use an authenticated mobile endpoint reachable without that browser login, with
the Roost bearer-token check intact. The app refuses redirects rather than sending
credentials to another destination. Do not expose the rest of an unprotected
Roost installation while configuring proxy routes. For local simulator development,
`http://127.0.0.1:<port>` and `http://localhost:<port>` are accepted.

## Included

- Server connection and device credentials saved in the iOS Keychain.
- Agent creation, rename, deletion with active-work protection, search, sections,
  collapse/expand, movement and reordering shared with web/PWA. Lists show running
  work and pending approvals, using Roost's original pixel characters.
- Identity, soul editing with revision conflicts and undo history, memory browsing,
  reflection schedules, and coding project settings with shared execution profiles.
- Automations with weekly, interval, one-time and cron schedules; timezone/date
  windows, model selection, notification policy, next-run preview, pause/resume,
  manual runs, retained run history, output and cancellation.
- A shared Feed tab beside Agents, with publication articles, generated stories,
  and personal updates in one native stream. All/Saved filters, source
  attribution, original links, a full reader, save/dismiss, relevance feedback,
  and discussion with an agent use the same server state as the web app. Stories
  are grouped by local publishing time: This morning, This afternoon, This evening,
  Yesterday, then calendar dates. Fuller summaries and bounded landscape images
  appear in the stream; the reader also displays the image. There are no unread
  badges, read/unread actions, or automatic read marking when opening a story.
- Feed preferences for interests, current priorities, RSS/Atom publications,
  refresh frequency, contributing agent, and optional important email updates.
  Jev relevance scoring has a secure API-key field and a separate, off-by-default
  opt-in for sending private update excerpts to TypeSafe. Feed generation starts
  only after enabling it in preferences; a contributing agent needs its own
  connected email source before it can surface email updates.
- Native conversation history, incremental live updates, older-message pagination,
  activity disclosure, inline Markdown and fenced code, send, follow-up, and stop.
- Swipe right on an assistant message to open its reply thread, with independent
  drafts and parent context. Reply controls stay hidden at rest. User messages
  cannot start reply threads in the native app or mobile API; VoiceOver and the
  assistant message context menu also offer Reply in thread.
- File attachments through Photos or the document picker (up to five, 20 MB each).
  Images show authenticated, downsampled previews in the conversation and composer;
  tap to open full-size Quick Look/share. Loading and unavailable-image states keep
  their space. The bounded image cache stays in memory and clears on reconnect.
- Native Markdown headings, lists, checklists, quotes, fenced code and horizontally
  scrolling tables. Code blocks include Copy; wide content preserves horizontal
  scrolling and offers Reply in its context menu.
- Explicit approvals and multiple-choice/free-text questions.
- Messages is the default response format, matching the PWA with left/right
  bubbles and hidden tool activity. Settings → Responses → Format can switch
  back to Codex. Reply threads retain their focused transcript layout.
- Queued and running responses use the web app's three-dot typing bubble. It
  respects Reduce Motion and stays hidden while an approval needs attention.
- System/light/dark appearance and device disconnection.
- Settings → Payments connects the server’s shared Link wallet, with browser sign-in,
  an expiring verification code, purchase approval links, and purchase status. The
  conversation’s card button opens that agent’s purchases. Returning to the app
  refreshes Link status; disconnecting the wallet requires confirmation because it
  affects all agents and devices on the server. Link links open in the system browser
  without the Roost device token.
- Default, Rosé Pine, Carbonfox, and Catppuccin themes, using the web app's exact
  light/dark semantic palettes. Choose Settings → Color theme for a live preview;
  the theme and appearance are saved on this iPhone independently of the browser.
- Messages lift from the measured bottom of the composer into their place in
  the conversation. The keyboard stays ready for a follow-up; incoming responses,
  typing bubbles, button presses, and swipe replies use restrained native motion
  and haptics. Reduce Motion removes travel, scaling, and repeating dot motion.
- Protected drafts and pending-send IDs restored after app termination. Retry
  reuses the exact payload and message ID so ambiguous network failures do not
  create duplicate turns. Drafts are excluded from device backups.
- Agent-owned Chat, Dashboard, Coding (coding agents), and Notes in a compact
  floating material bar. Small icons retain 44-point touch targets; a spring
  selection respects Reduce Motion, and an opaque fallback respects Reduce
  Transparency. Navigation yields space to the keyboard. Each section preserves
  its own navigation stack.
- Native dashboard metrics, tasks, links, tables and Swift Charts: line, grouped
  and stacked bars, area, donut and scatter. Expand values or data sources to
  inspect the underlying rows. Discuss opens the owning agent's chat without
  sending or replacing an existing draft.
- Coding job filters, preview report expiry, latest changes, verification, PR
  links, assignment/output, coordinating-agent discussion, direct worker messages,
  saved feedback/continuation, and stop. Worker receipts retain the server's
  delivery semantics; failure acknowledgment requires explicit inspection.
- Shared server Notes in one continuous native text canvas. Tap an existing line
  to edit or the blank canvas to append. Type `# ` / `## ` / `### ` for headings,
  `[] ` or `[ ] ` for tasks, `- ` for bullets, and `1. ` for numbered lists.
  Markdown bold, italic, and links format inline; the keyboard toolbar also offers
  styles, checklists, bold/italic/links, and undo/redo. Return continues lists and
  an empty Return exits them. Stable block IDs, autosave, protected local recovery, agent
  instructions, and browsable/restorable revision history. Independent block edits
  reconcile; overlapping changes require reviewing both versions. Pending writes
  retain their exact request ID across restart and never overwrite a newer revision.
- Foreground-only polling. Agents continue running on the server when the app
  sleeps. Reopening the app refreshes saved conversation state.
- More → Computer streams the shared desktop through a bundled noVNC renderer
  and native authenticated WebSocket. Watch, take/return control, type, and send
  special keys. Backgrounding disconnects and releases control; foregrounding
  reconnects with a fresh device-bound ticket. Device tokens never enter WebKit.
- Settings includes shared dashboard/notification preferences, local activity
  details, Codex device-code connection, and replacing an expired device token.
  Browser passkeys and sessions open their separately authenticated browser flow.
- Native notifications use APNs when the server and signed app are configured.
  Enable them explicitly in Settings → Notifications. Notification taps verify
  the current device registration before opening the owning agent/reply thread;
  disabling or revoking a device removes its registration.

Native push needs Apple signing and provider configuration, described below.
Conversation history requires a connection; drafts have
local recovery. TestFlight/App Store distribution also needs Apple account setup.
The server must be updated to expose the new mobile endpoints before using these
features. Building the client does not publish or update a running Roost server.

## Apple push setup

Create an APNs authentication key and a matching Push Notifications-enabled app
identifier in your Apple Developer account. Keep the `.p8` key on the server and
set these variables there:

```sh
ROOST_APNS_TEAM_ID=YOUR_TEAM_ID
ROOST_APNS_KEY_ID=YOUR_KEY_ID
ROOST_APNS_PRIVATE_KEY_PATH=/private/path/AuthKey.p8
ROOST_APNS_BUNDLE_ID=dev.roost.iphone
ROOST_APNS_ENVIRONMENT=sandbox
```

Generate the app with the matching environment, then select your signing team in
Xcode and use the same bundle identifier as the server:

```sh
ROOST_IOS_APNS_ENVIRONMENT=sandbox corepack pnpm ios:generate
```

Use `production` on both sides for TestFlight/App Store builds. Generation without
this variable creates a simulator-friendly project without the push entitlement.
No Apple key or team is bundled or inferred. Settings explains missing capability
or server configuration before offering the system permission prompt. Existing
notification categories and quiet-automation preferences also gate native delivery.

Provider requests use ES256 and HTTP/2 with bounded timeouts; invalid/expired APNs
registrations are removed without deleting newer registrations. APNs tokens are
stored privately in `mobile.sqlite`, alongside their owning revocable device.
See [verification](VERIFICATION.md) for what was tested and physical-device limits.
Apple documents [provider authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns)
and [notification requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns).

## Verify

From the repository root:

```sh
corepack pnpm test:mobile
# After building the server:
corepack pnpm test:mobile:production
corepack pnpm test:mobile:desktop
corepack pnpm ios:generate
# Leave this disposable fixture running in a separate terminal:
corepack pnpm dev:mobile-fixture
# In another terminal, after building the web server, for the desktop UI test:
corepack pnpm dev:desktop-fixture
# Seed a photo for the image picker test (use your simulator's device ID):
xcrun simctl addmedia booted apps/ios/Roost/Resources/Assets.xcassets/AppIcon.appiconset/Icon.png
# Then run native unit and UI tests:
xcodebuild -project apps/ios/Roost.xcodeproj -scheme Roost \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath apps/ios/build -parallel-testing-enabled NO test
```

The UI fixture binds only to loopback on port 4399, uses a disposable database and
a public test-only token, and never invokes Codex or accesses production data.
Stop it with Ctrl-C to clean up. The UI test exercises the normal connection form,
sending, approval, and threaded replies; it does not bypass app authentication.

`python3 apps/ios/generate-project.py` regenerates the committed Xcode project,
bundled character assets from `apps/web/src/assets/*.svg`, and `Themes.json` from
`apps/web/src/features/settings/themes.ts`. Run it after adding/removing Swift files or
changing web theme palettes. It uses only Python's standard library.

## API contract

All routes are under `/api/mobile/v1/`, require `Authorization: Bearer <token>`,
and return JSON with `Cache-Control: private, no-store`, except file downloads.
Browser cookies cannot authenticate this API. Tokens do not authenticate web,
desktop, or other API routes. Invalid and expired credentials return 401. Errors
use `{ "error": "…" }`; workspace validation returns actionable store messages,
with HTTP 409 for note revision conflicts. Other unexpected errors remain generic.

| Method | Route | Purpose |
| --- | --- | --- |
| GET / DELETE | `session` | Verify API version / revoke current device |
| GET | `payments` | Shared Link wallet and purchases; optional `agentId` filter |
| POST | `payments/connect` | Start Link wallet connection |
| POST | `payments/refresh` | Refresh Link connection and purchase statuses |
| DELETE | `payments/connection` | Disconnect this server’s shared Link wallet |
| GET | `agents` | List agents |
| POST / DELETE | `agents` / `agents/:id` | Create / delete with active-work protection |
| POST | `agents/:id/name` | Rename agent |
| GET | `agent-options` / `agent-activity` | Creation choices / running and approval state |
| GET / POST | `agent-navigation` | Shared sections, ordering, collapse and membership |
| GET | `agents/:id/identity` | Soul, memories, history and reflection preferences |
| POST | `agents/:id/soul`, `soul-undo`, `reflection`, `reflect` | Revision-safe soul edits, undo, reflection preferences and runs |
| GET / POST | `agents/:id/coding-settings` | Repository, instructions, sources and execution profile |
| GET / POST / DELETE | `execution-profiles` / `execution-profiles/:id` | Shared local/SSH execution profiles |
| GET / POST | `agents/:id/automations` | List / create or revision-checked edit |
| DELETE | `agents/:id/automations/:automationId` | Delete automation |
| POST | `agents/:id/automations/:automationId/toggle` / `run` | Pause/resume / enqueue |
| GET / POST | `agents/:id/automations/models` / `agents/:id/automations/preview` | Available models / schedule preview |
| GET | `agents/:id/runs` / `agents/:id/runs/:runId` | Run history / details and output |
| POST | `agents/:id/runs/:runId/stop` | Stop an automation run |
| GET / POST | `settings/notifications` / `settings/dashboards` | Shared notification categories / dashboard preference |
| GET / POST / DELETE | `notifications/push` | Status / register this device / disable native push |
| GET | `account` | Codex connection status |
| GET / POST / DELETE | `account/login` | Poll / start / cancel device-code sign-in |
| GET | `computer` | Desktop availability |
| POST | `computer/viewer` / `computer/control` | Device-bound viewer ticket / control lease |
| WebSocket | `computer/socket?ticket=…` | Authenticated desktop bridge; single-use ticket |
| GET | `feed?filter=all\|unread\|saved&before=…` | Shared feed page, settings, and refresh status |
| POST | `feed/refresh` | Queue a feed refresh; returns 202 with status |
| POST | `feed/settings` | Revision-checked interests, publications, privacy, and ranking settings |
| POST | `feed/items/:id` | `{action}`: save/unsave, read/unread, dismiss/restore, more/less |
| POST | `feed/items/:id/discuss` | Idempotent `{requestId, agentId?}`; returns agent and conversation IDs |
| GET | `agents/:id/conversation` | Snapshot; optional `conversationId`, `since`, `before` |
| POST | `agents/:id/messages` | Send `{messageId, conversationId?, text, attachmentIds?}` |
| POST | `agents/:id/stop` | Cancel `{id: runId}` |
| POST | `agents/:id/threads` | Open/reuse `{parentMessageId}` for an assistant message |
| GET / POST | `agents/:id/approvals` | Read pending requests / answer `{id, response}` |
| GET / POST | `agents/:id/dashboard` | Widgets/data sources / `{enabled}` server preference |
| GET | `agents/:id/jobs` | Agent-owned jobs with workspace summaries |
| GET | `agents/:id/jobs/:jobId` | Job, workspace, feedback, worker receipts and blockers |
| POST | `agents/:id/jobs/:jobId/messages` | Direct worker `{requestId, text}` |
| POST | `agents/:id/jobs/:jobId/feedback` | Save `{requestId, text, previewRevision}` |
| POST | `agents/:id/jobs/:jobId/continue` | `{requestId, revision, messageIds}` |
| POST | `agents/:id/jobs/:jobId/stop` | Request worker interruption |
| POST | `agents/:id/jobs/:jobId/acknowledge` | Explicit inspection `{inputId}` |
| GET / POST | `agents/:id/note` | Shared snapshot / `{requestId, revision, blocks}` |
| GET | `agents/:id/note/history?before=…` | Revision metadata, 100 per page |
| GET | `agents/:id/note/:revision` | Inspect a saved revision |
| POST | `agents/:id/note/instructions` | `{requestId, revision, instructions}` |
| POST | `agents/:id/note/restore` | `{requestId, revision, targetRevision}`; content only |
| POST | `files` | Multipart `agentId` and `file` |
| GET | `files?agentId=…&id=…` | Download a file owned by that agent |

The API delegates to existing server stores, preserving run identity, attachment
ownership, thread scope, approval validation, and maintenance fences. Tokens are
stored only as SHA-256 hashes in `mobile.sqlite` beside `roost.sqlite`, with mode
0600. Include that file in data-directory backups. Device names and expiry times
are available through the CLI; secret tokens cannot be retrieved afterward.

## Code formatting

Swift code is split by screen and reusable view. The checked-in `.swift-format`
configuration uses four-space indentation and a 100-column target. Format and
check only source directories (not generated build products):

```sh
xcrun swift-format format --in-place --recursive --configuration apps/ios/.swift-format apps/ios/Roost apps/ios/RoostTests apps/ios/RoostUITests
xcrun swift-format lint --strict --recursive --configuration apps/ios/.swift-format apps/ios/Roost apps/ios/RoostTests apps/ios/RoostUITests
```

The Python project generator uses Black formatting.
