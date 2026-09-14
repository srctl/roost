# Native iPhone verification

Captured from the native SwiftUI app on an iPhone 16 Pro simulator running iOS
18.6. All conversations and agents shown are fictional fixture data. No live
Roost account or provider was used.

## Compact navigation and continuous Notes

The refreshed workspace screenshots below show the smaller floating material
navigation bar and the continuous native notepad. [Chat with the glass bar](conversation-glass.png)
keeps the composer visible above navigation. Notes uses one text surface with
inline formatting, Markdown heading/list/task shortcuts, and a keyboard accessory
for styles, bold, italic, links, undo and redo. No per-block editor sheet remains. [Final Notes canvas](note-canvas-native.png)
also shows a checklist toggle confirmed through the authenticated fixture API.

All 19 unit tests and both UI flows passed across the final verification runs:
`/tmp/roost-canvas-layout.xcresult` (full suite),
`/tmp/roost-canvas-verified.xcresult` (updated editor and shared workspace flow),
and `/tmp/roost-canvas-caret.xcresult` (final 19 unit tests).
The checks include native autocorrection-safe typing, exact ranges between empty
paragraphs, emoji and rich-text preservation, Markdown conversion, undo/redo,
autosave without keyboard dismissal, authenticated server persistence, relaunch,
chat/replies/approvals, coding workspaces and all theme variants. Swift-format
strict lint and whitespace checks passed. Native iOS material is used with the
installed iOS 18 SDK; Reduce Transparency uses an opaque fallback.

## Dashboards, coding, and shared Notes

- [Native dashboard and chart](dashboard-native.png)
- [Shared Notes](shared-notes-native.png)
- [Native rich-text editor](note-editor-native.png)
- [Note revision history](note-history-native.png)
- [Coding jobs](coding-jobs-native.png)
- [Job workspace](coding-workspace-native.png)
- [Direct worker conversation](worker-conversation-native.png)

Verified against main `2b70c33` (0.1.42), with local native/API work preserved.
The final simulator run passed 11 unit tests and both UI flows (13 total), including
notes autosave without keyboard dismissal, server persistence and relaunch,
formatting round-trip, revision conflict reconciliation, protected pending-write
recovery, expiring preview reports, dashboards, coding jobs, and direct messages.
Existing chat/reply/approval/theme/motion regressions also passed. Results:
`/tmp/roost-workspaces-final.xcresult`. The final worker-composer adjustment also
passed the complete workspace UI flow, asserting that the keyboard stays visible
after send and that the full bold note persists on the shared server:
`/tmp/roost-workspaces-keyboard.xcresult`.

The focused mobile, Notes, dashboard, coding workspace and discussion server suite
passed 24 tests. An additional continuation check covered current revision,
selected feedback ownership and idempotent retry. TypeScript, Swift formatting,
Biome on changed API/test files, production build, and production mobile auth
smoke passed. The upstream worker-conversation suite has a Linux `/proc` listener
ownership assertion that returns `unverified` on macOS; that existing platform
check did not pass here. No real worker, deployment, or live notes were used.

## Conversation and appearance

- [Connect](connect.png)
- [Agents](agents.png)
- [Conversation](conversation.png)
- [Reply thread](reply-thread.png)
- [Dark conversation](conversation-dark.png)
- [Catppuccin conversation](conversation-catppuccin.png)
- [Send animation recording](message-send.mp4)
- [Reduced-motion multiline send](reduced-motion-multiline.png)

| Theme | Light | Dark |
| --- | --- | --- |
| Default | [View](theme-default-light.png) | [View](theme-default-dark.png) |
| Rosé Pine | [View](theme-rose-pine-light.png) | [View](theme-rose-pine-dark.png) |
| Carbonfox | [View](theme-carbonfox-light.png) | [View](theme-carbonfox-dark.png) |
| Catppuccin | [View](theme-catppuccin-light.png) | [View](theme-catppuccin-dark.png) |

Validation completed on September 13, 2026:

- iOS simulator build and four XCTest unit tests passed.
- XCUITest passed: enter server/token, connect, load history, send, approve,
  swipe an assistant message to reply, ignore swipes on user messages, relaunch
  with the saved Keychain connection, and dark mode.
- 184 server tests passed, including the new mobile API tests.
- TypeScript typecheck and explicit-path Biome checks passed.
- Production server/CLI builds, existing production authentication smoke,
  new production mobile authentication smoke, and public-site checks passed.
- `git diff --check` passed.

The root `pnpm check` wrapper stopped at lint because Biome's existing
`!!**/.codex` exclusion ignores this checkout's absolute worktree location.
Lint was run against explicit source/test/script/config paths; the remaining
check stages were run individually. No claim is made that the wrapper itself
passed.

Physical-device signing, server deployment, and Apple distribution are not
performed by this verification. See [setup and scope](../README.md).

Follow-up: assistant-only swipe replies passed the native UI test and mobile API
regression tests. Reply text/icons are absent from messages at rest.

Messages-format follow-up: refreshed the screenshots above and passed all five
native tests. The UI test checks the default bubble alignment, absence of author
headers and tool activity, assistant-only swipe replies, and switching to Codex
format in Settings. Light and dark screenshots were visually reviewed. Swift
format lint, Black check, TypeScript typecheck, and project-generator idempotence
also passed after splitting and formatting the native source files.

Typing-bubble follow-up: all five native tests passed with the three-dot indicator
replacing queued/working text. The UI test verifies it is hidden during an approval
and appears after approval. Screenshots were refreshed, the dark bubble was
visually checked, and the updated app was reopened in the simulator.

Custom-theme and motion follow-up: all seven native tests passed (six unit tests
and one extended UI flow). The UI flow checks all eight palette variants, saved
theme/appearance after relaunch, messages and threads, and an accepted send whose
response is interrupted: restart and retry preserve exactly one message. The
Reduce Motion path uses a Debug-only environment override and verifies multiline
sending with the keyboard remaining open. Native palettes were compared directly
with the web catalog and match exactly. Swift-format, Black, TypeScript, explicit
fixture Biome checks, and generator idempotence passed.

The send recording was reviewed frame by frame: the bubble begins at the measured
composer bottom, lifts across the viewport boundary, and settles into its row.
Representative light/dark themes and the multiline layout were visually reviewed.
Haptic feel has not been evaluated on a physical iPhone.
