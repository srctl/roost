# Roost

Roost connects an existing Roost server to your Mac. Use the same web
workspace in a dedicated window, choose an agent and the Messages conversations
it may read, or enable a short computer-control session. Agents continue running
on the server when you close the window; local tools require the companion to
remain connected and your Mac to be awake.

The first build targets macOS 14 or later. It requires a server with the
companion API, a dedicated device token, and macOS permissions for the local
features you enable. See the [desktop app guide](https://github.com/srctl/roost/blob/main/apps/desktop/README.md)
for building, packaging, connecting, access boundaries, and verification.

Messages access is limited to selected chats and reading. Computer control is
a separate grant that operates the real main display. You can stop it from the
toolbar, menu bar, or Command–Shift–Escape; each session expires after 10 minutes.
Neither feature creates a separate Apple Messages identity or a virtual desktop.
