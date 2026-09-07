# Remote desktop setup

This guide provisions a persistent Linux desktop and browser for Roost. It is
based on a setup validated on Ubuntu 24.04 amd64 with systemd. The browser
profile stays on the host when a viewer disconnects. Installing Roost alone does
not create this desktop.

For Roost's built-in viewer and agent controls, see [Shared computer](computer.md).
The separate noVNC service below also lets you connect through an SSH tunnel.

## Choose the session

Before installing anything, verify the target host's OS, architecture, user,
home directory, service manager, administrative access, and available resources.
Inspect existing desktops, browser profiles, processes, display numbers,
services, and ports. Reuse a suitable desktop instead of replacing another
session. On exe.dev, `ssh exe.dev ls --json` can identify your VM's SSH destination.

Use a persistent, non-root account for the desktop and browser. The example
service files use an account named `roost` with home `/home/roost`; replace
`User`, `Group`, and all home paths with your actual session owner. Use the same
operating-system user that runs Roost. This is not an instruction to create an
additional account.

The reference setup used XFCE 4.18, TigerVNC 1.13.1, Chrome 152.0.7977.82, noVNC
1.3.0, and websockify 0.10.0. These are historical observations, not version pins.
It ran on 2 CPUs and 8 GiB RAM; installation added approximately 0.7 GiB of disk
usage including downloads and caches. Those values are not measured minimum
requirements. Allow space for browser data and agent files as well.

The commands below require Ubuntu amd64, systemd, sudo, and outbound access to
OS repositories and Chrome's official distribution source. ARM hosts, other
distributions, containers without systemd, and Wayland desktops need a different
package or session recipe. Keep browser sandboxing enabled; do not add
`--no-sandbox` to work around a failed launch.

## Install packages

Run on the host:

```sh
sudo apt-get update -qq
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  tigervnc-standalone-server xfce4 xfce4-terminal dbus-x11 novnc websockify \
  xfonts-base curl ca-certificates imagemagick xdotool

curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  -o /tmp/roost-google-chrome.deb
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/roost-google-chrome.deb
```

Chrome's package configures its vendor update source. OS and browser updates
remain the machine owner's responsibility. ImageMagick and `xdotool` provide
Roost's screenshot and input support.

As the desktop session user, create `~/.vnc` with mode `0700` and save this script
as `~/.vnc/xstartup`, also with mode `0700`:

```sh
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
exec dbus-run-session -- startxfce4
```

The desktop needs its own D-Bus session. System services with an explicit `User`
work on hosts where `systemctl --user` fails with
`Failed to connect to bus: No medium found` in an SSH session.

## Configure systemd

Create `/etc/systemd/system/roost-desktop.service`, substituting your user, group,
and home directory. Display `:1` uses VNC port 5901; choose a free display if
another desktop already uses it.

```ini
[Unit]
Description=Roost XFCE desktop over SSH-only VNC
After=network.target

[Service]
Type=simple
User=roost
Group=roost
WorkingDirectory=/home/roost
Environment=HOME=/home/roost
ExecStart=/usr/bin/tigervncserver :1 -fg -localhost yes -SecurityTypes None -geometry 1600x1000 -depth 24 -AlwaysShared -xstartup /home/roost/.vnc/xstartup
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

For a standalone browser viewer, create
`/etc/systemd/system/roost-novnc.service` with the same user and group:

```ini
[Unit]
Description=Roost browser desktop viewer (SSH tunnel only)
After=roost-desktop.service
Requires=roost-desktop.service

[Service]
Type=simple
User=roost
Group=roost
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5901
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start both:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now roost-desktop.service roost-novnc.service
```

`SecurityTypes None` relies on authenticated SSH access and trusted local
processes. Every local user or process can reach the loopback listeners; this
recipe is not a multi-tenant boundary. Keep both listeners on loopback. Do not
publish these unauthenticated services through a public interface or HTTP proxy.
Roost's embedded viewer uses the protected app connection described in
[Shared computer](computer.md).

## Connect through SSH

On your computer, replace `user@your-server` with the host's SSH destination:

```sh
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -fN \
  -L 127.0.0.1:6080:127.0.0.1:6080 \
  -L 127.0.0.1:5901:127.0.0.1:5901 user@your-server
```

Open [the desktop viewer](http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=remote).
The native VNC endpoint is `127.0.0.1:5901`. Both local ports must be free;
reuse an existing verified tunnel or choose different local ports if needed.
Native VNC client compatibility needs verification with your chosen client.

The browser's local HTTP/WebSocket connection is unencrypted, so noVNC may label
it that way. Traffic to the host travels inside encrypted SSH. Local processes
on your computer can access the forwarded ports while the tunnel is open.
Restart the tunnel after it exits, including after a computer restart or a long
network failure. Omit `-f` to keep it in a terminal and stop it with Ctrl-C.
Closing a viewer tab does not stop the background tunnel or desktop.

## Verify the desktop

Check the services and listeners on the host:

```sh
systemctl is-active roost-desktop roost-novnc
systemctl is-enabled roost-desktop roost-novnc
ss -lnt
journalctl -u roost-desktop -u roost-novnc -n 50 --no-pager
```

As the session user, inspect desktop logs and windows:

```sh
tail -n 50 ~/.vnc/*.log
DISPLAY=:1 xwininfo -root -tree
```

Confirm that VNC listens only on `127.0.0.1:5901` (and optionally `[::1]:5901`),
noVNC listens only on `127.0.0.1:6080`, and `/vnc.html` responds. Then make a real
viewer connection, inspect the rendered desktop, and launch the browser. Open
ports alone do not prove the desktop works.

Handle browser terms, passwords, MFA, and account sign-ins yourself. Verify that
Roost's computer control uses this same display and profile. Native viewer
support, clipboard behavior, and reboot recovery must be tested separately if
you need them; enabling services for boot is not a reboot test.

To restart after a desktop logout:

```sh
sudo systemctl restart roost-desktop roost-novnc
```

Restarting the desktop ends its GUI applications. Coordinate with anyone using
it first. To stop and disable the services without deleting browser data:

```sh
sudo systemctl disable --now roost-novnc roost-desktop
```

## Connect the desktop to Roost

Configure the display, viewer origin, and loopback VNC port as described in
[Shared computer](computer.md#linux-configuration). Roost embeds the VNC stream,
starts in view-only mode, and coordinates agent input when you take control.
Closing its viewer detaches your session and leaves the desktop running.
Recording and replay are not implemented.

The stream comes from the remote display. An agent using a separate headless
browser will not appear there. Keep Chrome on the session owner's normal profile
(`~/.config/google-chrome`); a temporary browser profile will not inherit its
sign-ins. Do not launch two independent browsers against one profile or copy
credentials to work around session problems. Roost's X11 adapter does not need a
Chrome remote debugging port.

A hosted viewer cannot use a hardcoded `127.0.0.1:6080` URL: that address resolves
on the viewer's computer. Roost reaches its configured VNC port on the Roost
host through its own WebSocket route. Remote app access needs an authenticated
HTTP and WebSocket proxy or an SSH tunnel. Origin checks do not replace
access authentication. External VNC clients do not participate in Roost's input
coordination.

Disconnecting leaves applications running. Rebooting the host ends those
processes, although its browser profile remains on disk and systemd can restart
the desktop. Websites may expire login sessions independently.

## For automated provisioning

A setup agent should inspect the actual platform and change only missing
configuration. Preserve desktops, profiles, services, provider routes, and
unrelated work. Record the installed packages, service files, user/home, display,
ports, browser profile, access method, and verification results. Return the
viewer URL, reconnect command, lifecycle commands, and remaining manual steps.
Keep credentials out of setup prompts, logs, documentation, and source control.
Verify rendered output and browser reuse before reporting the setup complete.

## References

- [exe.dev SSH](https://exe.dev/docs/cli-ssh)
- [TigerVNC server options](https://tigervnc.org/doc/Xvnc.html)
- [noVNC and loopback-only proxy setup](https://novnc.com/noVNC/)
