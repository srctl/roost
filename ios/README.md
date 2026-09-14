# Roost for iPhone

A native SwiftUI client for an existing Roost server. Requires iOS 17 or later
and Xcode 16 or later. No third-party Swift packages are required.

[Simulator screenshots and verification](screenshots/README.md).

## Run

Open `Roost.xcodeproj`, select the **Roost** scheme and an iPhone simulator, and
run. For a physical iPhone, choose your Apple development team under Signing &
Capabilities and use a unique bundle identifier if required by your account.
Simulator tests use normal ad-hoc signing; disabling signing also disables the
Keychain entitlement and prevents connection storage.

The server must include this branch's `/api/mobile/v1` endpoints. On the host
running Roost:

```sh
roost mobile create --name iPhone --output ~/iphone-token.txt
```

For a source checkout, run the same CLI against the **same data directory** used
by the web server:

```sh
ROOST_DATA_DIR=/absolute/path/to/data node --import tsx src/cli/main.ts mobile create --name iPhone --output /private/path/iphone-token.txt
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
- Agent list, search, and pull-to-refresh, using Roost's original pixel characters.
- Native conversation history, incremental live updates, older-message pagination,
  activity disclosure, inline Markdown and fenced code, send, follow-up, and stop.
- Swipe right on an assistant message to open its reply thread, with independent
  drafts and parent context. Reply controls stay hidden at rest. User messages
  cannot start reply threads in the native app or mobile API; VoiceOver and the
  assistant message context menu also offer Reply in thread.
- File attachments through the system document picker (up to five, 20 MB each),
  authenticated downloads, and system Quick Look/share UI.
- Explicit approvals and multiple-choice/free-text questions.
- Messages is the default response format, matching the PWA with left/right
  bubbles and hidden tool activity. Settings → Responses → Format can switch
  back to Codex. Reply threads retain their focused transcript layout.
- Queued and running responses use the web app's three-dot typing bubble. It
  respects Reduce Motion and stays hidden while an approval needs attention.
- System/light/dark appearance and device disconnection.
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

This first native slice does not yet include agent creation/editing, automation
editing, the shared desktop, APNs notifications,
or full Markdown table rendering. Conversation history requires a connection;
only drafts are stored locally. APNs and TestFlight/App Store distribution require
separate server and Apple account configuration. Nothing in this change publishes
or updates a running Roost server.

## Verify

From the repository root:

```sh
node --import tsx --test tests/mobile.test.ts tests/mobile-workspaces.test.ts
# After building the server:
node --import tsx scripts/test-mobile-production.ts
# Leave this disposable fixture running in a separate terminal:
node --import tsx tests/fixtures/mobile-server.ts
# Then run native unit and UI tests:
xcodebuild -project ios/Roost.xcodeproj -scheme Roost \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath ios/build test
```

The UI fixture binds only to loopback on port 4399, uses a disposable database and
a public test-only token, and never invokes Codex or accesses production data.
Stop it with Ctrl-C to clean up. The UI test exercises the normal connection form,
sending, approval, and threaded replies; it does not bypass app authentication.

`python3 ios/generate-project.py` regenerates the committed Xcode project,
bundled character assets from `src/assets/*.svg`, and `Themes.json` from
`src/features/settings/themes.ts`. Run it after adding/removing Swift files or
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
| GET | `agents` | List agents |
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
xcrun swift-format format --in-place --recursive --configuration ios/.swift-format ios/Roost ios/RoostTests ios/RoostUITests
xcrun swift-format lint --strict --recursive --configuration ios/.swift-format ios/Roost ios/RoostTests ios/RoostUITests
```

The Python project generator uses Black formatting.
