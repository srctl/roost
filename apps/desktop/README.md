# Roost Desktop

An Electron companion for an existing Roost server. The first release targets
macOS 14 or later and packages for the architecture of the build machine.
Agents, schedules, files, and conversation history remain on the server.

## Build and run

From the repository root, install the workspace dependencies, then run:

```sh
corepack pnpm desktop:dev
```

Building the native capture/input helper requires Xcode command line tools and Python 3.
`corepack pnpm desktop:pack` creates an ad-hoc signed app in
`apps/desktop/output/desktop/Roost Desktop.app` and a ZIP archive alongside it. Set
`ROOST_DESKTOP_OUTPUT_DIR` to choose another output directory. Packaging refuses
to overwrite an existing app. Developer ID signing, notarization, automatic
updates, and Windows/Linux local adapters are not included in this first build.

## Connect

Update the Roost server to a build containing the companion API. Create a
dedicated device credential on that server, using its active data directory:

```sh
roost mobile create --name Mac --output /private/path/mac-token.txt
```

Enter the server's HTTPS origin and token in the app. Loopback HTTP is accepted
for development. The credential uses the existing revocable device-token system
and expires after 90 days. The API must be directly reachable without an
interactive authentication proxy. Browser sign-in remains separate: signing in
to the workspace never exposes the device token to that page.

Credentials are encrypted with Electron safeStorage on the Mac. Disconnect
removes the saved connection and local grants; it does not revoke the server
credential. Revoke it explicitly with `roost mobile revoke <device-id>` if needed.
Web cookies remain in the app's per-server browser partition until cleared by
the browser sign-out flow or removal of the app's user data.

## Local access

Choose one agent in Companion settings. Access starts off, resets on restart or
reconnection, and is enforced on the Mac as well as the server.

### Messages

Install [imsg](https://github.com/openclaw/imsg) separately, then allow Roost
Desktop Full Disk Access in System Settings. The app finds imsg in
`~/.local/bin`, `/opt/homebrew/bin`, or `/usr/local/bin`.

Choose conversations from a local list of up to 100 recent chats. Only the
selected chat IDs and labels are shared with the server. The agent can list
those shared chats and read up to 100 recent messages from one selected chat;
an optional filter searches that bounded page. It cannot read other chats,
open attachments, mark messages as read, or send through this integration.
Messages content is returned on demand rather than continuously mirrored.

Tool: `roost_desktop_messages`, with `action=chats` or
`action=history, chatId, limit, query?`.

### Computer

Enable a 10-minute session for your selected agent. Allow screen recording and
Accessibility in System Settings. The agent can capture your main display,
click, move, scroll, send shortcuts, and type Unicode text. Screenshots are
bounded JPEGs; pixel coordinates are mapped to the main display's logical
coordinates, including Retina scaling. A fresh screenshot is required before
input and each action returns another screenshot.

This operates your real desktop and can interfere with your input. It does not
create a virtual desktop or restrict UI interaction to the selected Messages
chats. Messages reading restrictions apply to the structured integration above;
enabling computer control is a separate, broader grant. User instructions and
Roost approvals still govern consequential actions, including sending messages;
the capture/input helper does not recognize or block particular app buttons.

Stop with the visible toolbar button, menu-bar item, or **Command–Shift–Escape**.
While a session is active, local permission edits and session renewal are locked.
Expiry, disconnect, revocation, and connection loss abort in-flight helpers.
Stopped runs are checked on the server and propagated on the next poll. Local
tools are unavailable while the Mac sleeps. Input requests are never replayed
after a timeout or reconnect.

Tool: `roost_desktop_computer`, with actions `screenshot`, `click`, `move`,
`scroll`, `key`, or `type`. It is distinct from the Linux server's
`roost_computer` tool.

## Security and server contract

The Roost workspace runs in a sandboxed WebContentsView with no preload, Node
access, or local IPC bridge. Only the bundled companion panel can change local
grants. Device API requests originate in the desktop main process, refuse
redirects, and never send credentials to another origin. Remote navigation and
popups open in the system browser; cross-origin authentication redirects need
an appropriate directly reachable Roost origin.

The authenticated API uses `/api/mobile/v1/companion/{connect,poll,result,disconnect}`.
Polling keeps an ephemeral lease alive and advertises local grants. Each tool
request is bound to its agent, active run, request UUID, and 15-second deadline.
The server rechecks persisted run capabilities at dispatch, delivery, and result
acceptance. Feed, handoff, and reflection runs cannot use these tools. Desktop
access is serialized per companion, and conflicting eligible desktops are
rejected rather than selected implicitly. The server must route a companion's
requests and agent runs to the same process; the current single-server Roost
deployment satisfies this requirement.

Screenshots and message excerpts become tool results in the agent's active
model session. Normal provider/session retention applies. They are not an
offline-only data source. The local activity panel records action labels, not
message bodies, screenshots, or tokens.

## Verify

```sh
corepack pnpm desktop:test
corepack pnpm --filter @roost/desktop test:e2e
corepack pnpm --filter @roost/web exec node --import tsx --test tests/companion.test.ts tests/run-capabilities.test.ts
corepack pnpm lint
corepack pnpm typecheck
```

The Electron test uses a disposable local server, fake device token, and isolated
user-data directory. It tests connection, agent selection, sandbox isolation,
the companion panel, and disconnect. It does not read personal Messages, change macOS permissions, or execute
desktop input. OS consent and credential encryption are simulated in the disposable process;
this test does not exercise the system Keychain. Local-tool tests exercise scope checks, coordinate
mapping, cancellation, and command construction using fixtures. The server
integration test uses real stores, device authentication, and run policies.

Live Messages reads, macOS permission/Keychain prompts, and real input injection require
explicitly enabling access in the installed app; they are not verified by these
fixture tests. The native helper is compiled and its shortcut self-check runs
during every Mac build.
