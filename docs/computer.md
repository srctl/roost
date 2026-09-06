# Shared computer and browser

Roost can show and operate the machine's existing X11 desktop. The live preview
appears in the conversation when an agent uses the computer, beneath its first
computer action in that turn. It stays there through subsequent actions, then
disappears when the run finishes or is stopped. Closing it dismisses it for the
rest of that run; a later run can open its own preview. Saved history never opens
a live screen. Click the monitor beside an agent's settings to open the desktop
yourself, including when the agent is idle. The header button opens the full-screen
desktop directly; Back returns to the conversation and restores any active inline
preview. A manually opened desktop stays open until you close it.
The inline preview also has an expand button for an edge-to-edge view. Both use an
in-app full-page dialog instead of the browser Fullscreen API, including on iPhone.
Expanding the inline preview preserves its VNC connection. Opening from the header
uses a separate viewer session and releases it when you return to chat.
After taking control, use **Trackpad** to slide the pointer, tap to click, and
scroll with two fingers. **Direct touch** clicks where you tap. **Recenter pointer**
moves it to the middle. The keyboard button opens the phone keyboard; Tab and
Enter are also available in the bottom bar. The view follows the visible viewport
as the keyboard opens and closes. It does not resize the remote desktop.
**Take control** enables pointer and keyboard input for sign-ins; **Return
control** resumes agent access. Closing the preview leaves the desktop and
browser running. Reconnect after a dropped connection.

Agents use `roost_computer` to see screenshots, click, move, scroll, type, and
press keys in that same session. This operates the existing Chrome profile,
including its sign-ins; it does not start a separate headless browser or copy
cookies. For ordinary retail purchases, the agent presents the checkout details
and asks for confirmation in Roost. After the user confirms, it may place that
specific order, including clicking the final purchase button. Changed checkout
details require a new confirmation. Other sensitive confirmations, passwords,
MFA, and authentication challenges still belong in the viewer, handled by the user.
This purchase confirmation behavior is enforced by the agent instructions; the
desktop adapter does not independently recognize or block checkout buttons.

All agents share this computer. Roost serializes their desktop access and blocks
agent screenshots and input while a viewer has control. Control expires if its
heartbeat stops; the server disconnects that viewer before allowing agent input.
After returning control, ask the agent to continue. Outside VNC clients and
programs on the machine do not participate in this coordination.

## Linux configuration

Use the desktop described in [the setup record](remote-desktop-setup.md), or an
existing X11 desktop owned by the same operating-system user as Roost. Install
ImageMagick (`import`) and `xdotool`. Keep the VNC listener on loopback. The
embedded client supports the existing trusted, single-user VNC session with no
VNC password; it relies on Roost's protected HTTP/WebSocket access.

For the installed systemd service, add a drop-in with:

```ini
[Service]
Environment=ROOST_DESKTOP_DISPLAY=:1
Environment=ROOST_DESKTOP_ORIGIN=https://roost-dev.exe.xyz
Environment=ROOST_DESKTOP_VNC_PORT=5901
```

Use your actual origin (scheme and host, plus port if present), display, and VNC
port. The port defaults to 5901. Reload systemd and restart Roost after changing
the environment. No Chrome restart or remote debugging port is required.

Computer access is disabled unless both DISPLAY and ORIGIN are configured.
Roost's browser client connects through `/api/desktop/socket`, using a short-lived,
single-use ticket and an exact Origin check. The server can only connect to its
configured loopback VNC port. noVNC defaults to view-only; this is an interaction
mode, not a separate user permission. Anyone authorized to use this Roost
installation can take control of its shared desktop.

Roost is still a single-user application. Keep it on loopback with SSH access,
or behind a reverse proxy that authenticates **both HTTP and WebSocket** requests.
On roost-dev, the existing private exe.dev HTTPS proxy provides that boundary.
Origin checks and tickets do not replace authentication. Do not expose the
no-auth VNC or noVNC listeners publicly.

The first message after upgrading migrates an older conversation to a thread
with the new tools. Visible history and the agent's private memory home are
preserved. Desktop images are supplied to Codex as tool results; the preview
itself streams directly from VNC. Recording and replay are not implemented.

This adapter currently targets Linux X11. macOS and Wayland need different
capture/input adapters; installing Roost alone does not provision a desktop.
