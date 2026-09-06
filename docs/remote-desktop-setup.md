# Remote desktop setup notes

Implementation record: September 5, 2026 (Pacific), September 6 (UTC).
This tracks a working machine setup and requirements for a future Codex setup
prompt. This records the original desktop provisioning. For the subsequent Roost viewer
and agent integration, see [shared computer setup](computer.md).

## Purpose

Let a person open an agent's remote desktop, use its browser, and sign into
services there. Keep the desktop and browser profile on the remote machine after
the viewer disconnects.

## Verified machine

| Item                    | Observed value                                              |
| ----------------------- | ----------------------------------------------------------- |
| Provider / host         | exe.dev / `roost-dev.exe.xyz`                               |
| OS / architecture       | Ubuntu 24.04.4 LTS / amd64                                  |
| Session user            | `exedev`, UID 1000, home `/home/exedev`                     |
| Administrative access   | SSH key authentication and passwordless sudo                |
| Service manager         | systemd; no working user service bus in the SSH session     |
| Capacity                | 2 CPUs, 8 GiB RAM, 25 GiB disk; about 17 GiB free afterward |
| Original desktop        | None                                                        |
| Existing provider proxy | Private, port 8000; left unchanged                          |
| Desktop                 | XFCE 4.18, TigerVNC 1.13.1, display `:1`                    |
| Browser                 | Google Chrome 152.0.7977.82, official amd64 Debian package  |
| Browser viewer          | noVNC 1.3.0 and websockify 0.10.0                           |

These resources are the tested configuration, not measured minimum requirements.
The installation increased rounded disk usage from 6.0 to 6.7 GiB, including
download/cache files. Package versions are observations, not required pins.

## Requirements to check on every target

1. Resolve the actual host and verify SSH access, OS, architecture, session user,
   home directory, privilege escalation, and service manager. On exe.dev, discover
   the VM with `ssh exe.dev ls --json`; use its returned SSH destination.
2. Inspect existing desktops, browser profiles, processes, display numbers,
   services, ports, available memory, and disk space. Reuse an appropriate desktop
   where possible; do not overwrite another session or occupied port.
3. Use a persistent, non-root account for the desktop and browser. This setup
   requires an X11 desktop, session D-Bus, fonts, a VNC server, and a browser.
4. Provide authenticated, encrypted viewer access. Here SSH supplies both;
   neither VNC nor noVNC is exposed on a public interface.
5. Allow outbound access to OS repositories and the chosen browser's official
   distribution source. The commands below apply to Ubuntu amd64 with systemd.
   Other distributions, ARM, containers without systemd, and existing Wayland
   desktops need a different package/session recipe.
6. Keep browser sandboxing enabled. Chrome ran as `exedev` without `--no-sandbox`.
   Diagnose platform restrictions if another target fails rather than silently
   disabling the sandbox.

## Installation performed

On the VM:

```sh
sudo apt-get update -qq
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  tigervnc-standalone-server xfce4 xfce4-terminal dbus-x11 novnc websockify \
  xfonts-base curl ca-certificates

curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  -o /tmp/roost-google-chrome.deb
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/roost-google-chrome.deb
```

Chrome's package also configures its vendor update source. Normal OS/browser
updates remain the machine owner's responsibility.

Created `/home/exedev/.vnc/xstartup` with mode `0700`, inside a `0700` directory:

```sh
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
exec dbus-run-session -- startxfce4
```

The desktop needs its own D-Bus session. System services with `User=exedev` were
used because `systemctl --user` returned `Failed to connect to bus: No medium found`.

Created `/etc/systemd/system/roost-desktop.service`:

```ini
[Unit]
Description=Roost XFCE desktop over SSH-only VNC
After=network.target

[Service]
Type=simple
User=exedev
Group=exedev
WorkingDirectory=/home/exedev
Environment=HOME=/home/exedev
ExecStart=/usr/bin/tigervncserver :1 -fg -localhost yes -SecurityTypes None -geometry 1600x1000 -depth 24 -AlwaysShared -xstartup /home/exedev/.vnc/xstartup
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Created `/etc/systemd/system/roost-novnc.service`:

```ini
[Unit]
Description=Roost browser desktop viewer (SSH tunnel only)
After=roost-desktop.service
Requires=roost-desktop.service

[Service]
Type=simple
User=exedev
Group=exedev
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5901
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enabled and started both:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now roost-desktop.service roost-novnc.service
```

`SecurityTypes None` intentionally relies on SSH authentication. Any process/user
on the VM can reach these loopback ports, as can local processes on the Mac while
its tunnel is open. This recipe assumes those local users/processes are trusted.
It is not a multi-tenant security boundary. Do not copy it onto a shared machine
without revisiting authentication/isolation, and never bind these unauthenticated
services to a public interface or publish them through an HTTP proxy.

## Connecting from the Mac

The following background tunnel was opened and verified:

```sh
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -fN \
  -L 127.0.0.1:6080:127.0.0.1:6080 \
  -L 127.0.0.1:5901:127.0.0.1:5901 roost-dev.exe.xyz
```

Open [the desktop viewer](http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=remote).
The native VNC endpoint is `127.0.0.1:5901`; a native viewer was not tested.
Both local ports must be free before running the tunnel command. Reuse an
existing verified tunnel or choose different local ports when needed.

The browser's local HTTP/WebSocket connection is unencrypted, so noVNC may label
it that way. Traffic between the Mac and VM travels inside encrypted SSH.
The tunnel must be restarted after it exits, such as after a Mac restart or a
prolonged network failure. Omit `-f` to keep it in a terminal and stop it with
Ctrl-C. Closing a viewer tab does not stop the background tunnel or desktop.

## Verification and current handoff

- Both services are `active` and `enabled`.
- `ss -lnt` shows noVNC on `127.0.0.1:6080`, and VNC on `127.0.0.1:5901`
  and `[::1]:5901`; no public desktop listeners.
- `/vnc.html` returns HTTP 200.
- A real noVNC connection through the Mac's SSH tunnel displayed the XFCE desktop.
- Remote pointer input opened Applications → Web Browser and launched Chrome.
- Chrome displayed its first-run terms screen. The user must review/accept it
  and perform sign-ins. No account authentication or saved login was tested.
- Reboot recovery, native VNC compatibility, clipboard transfer, and agent reuse
  of the browser are not yet verified. Services are enabled for boot, but the VM
  was not rebooted to test this.

Diagnostic commands on the VM:

```sh
systemctl is-active roost-desktop roost-novnc
systemctl is-enabled roost-desktop roost-novnc
ss -lnt
journalctl -u roost-desktop -u roost-novnc -n 50 --no-pager
tail -n 50 /home/exedev/.vnc/*.log
DISPLAY=:1 xwininfo -root -tree
```

To start again after a desktop logout, run
`sudo systemctl restart roost-desktop roost-novnc`. Restarting the desktop ends
its running GUI applications; coordinate with anyone using it first. To stop
and disable this setup without deleting browser data, use
`sudo systemctl disable --now roost-novnc roost-desktop`.

## Requirements for a future Roost setup prompt

- Accept a target machine and desired session owner; discover platform details
  and select an appropriate recipe rather than assuming `exedev`, apt, or amd64.
- Inspect first, change only missing configuration, and preserve existing
  desktops, profiles, services, provider routes, and unrelated work.
- Record packages, service files, session user/home, display, ports, browser
  profile, connection method, verification evidence, and remaining manual steps.
- Verify an actual rendered desktop and browser launch, not just open ports.
  Hand browser terms, credentials, and MFA to the user; keep secrets out of
  setup prompts, documentation, logs, and source control.
- Define how the agent uses the same browser session. In this setup the desktop
  is `DISPLAY=:1` and Chrome uses the normal profile under
  `/home/exedev/.config/google-chrome`. A separate headless or temporary profile
  will not automatically inherit those sign-ins. Do not launch two independent
  browsers against one profile or copy credentials as a workaround.
- Choose and verify the agent's browser-control mechanism separately. No remote
  debugging port or Roost browser adapter was configured here. A shared Unix
  account also shares access to its browser data; agent isolation is unresolved.
- Distinguish durable profile data from open application state: disconnecting
  leaves the desktop running, while a reboot terminates processes. Websites may
  expire sessions regardless of profile persistence.
- Return the viewer URL, exact reconnect command, lifecycle commands, and any
  platform limitations. A future embedded Roost viewer needs authenticated HTTP
  and WebSocket routing; do not expose this no-auth listener to achieve it.

## Live desktop inside Roost

Requested next capability: stream the desktop currently visible in noVNC into
Roost so the user can watch activity on the remote machine. This is a tracked
requirement, not implemented functionality.

Proposed approach: embed a noVNC client connected to the existing desktop's VNC
stream. The source is the remote display, not a screen capture of the user's
local viewer tab. Both viewers should show the same running session.

- Associate each viewer with the correct machine and desktop session. Activity
  from an agent using a separate headless browser will not appear on this display.
- Provide an authenticated WebSocket route to the target's private VNC bridge.
  Authorize access to that specific machine/session and validate the connection
  origin. Keep upstream access private and use HTTPS/WSS for hosted Roost.
- Do not hardcode `127.0.0.1:6080` into hosted Roost: in a user's browser it refers
  to that user's computer and only works with their local SSH tunnel. Decide how
  Roost reaches the machine based on where Roost itself runs.
- Show connection, disconnection, and reconnecting states. Closing the panel
  should detach the viewer without ending the remote desktop or its applications.
- Proposed interaction: watch by default, with an explicit take-control action
  for sign-ins or intervention. Coordinate agent input while a person controls
  the session; the handoff mechanism remains to be designed.
- Verify simultaneous viewing, live updates, resize behavior, reconnecting, and
  rejection of unauthorized connections against a real remote machine.

Initial scope is a live view. Recording, replay, and audio are not requested.

## References

- [exe.dev SSH](https://exe.dev/docs/cli-ssh)
- [TigerVNC server options](https://tigervnc.org/doc/Xvnc.html)
- [noVNC and loopback-only proxy setup](https://novnc.com/noVNC/)
