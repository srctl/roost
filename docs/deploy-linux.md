# Deploy on a Linux server

Use the packaged installer on a persistent **Linux x64 machine with systemd**.
This applies to a conventional VPS, a Linux VM you already operate, or an
always-on home server. [exe.dev](deploy-exe-dev.md) adds a managed private proxy
to this model.

## 1. Inspect the target

Use your actual SSH destination in place of `user@your-server`. Before changing
anything, connect and inspect the OS, architecture, service manager, and current
user:

```sh
ssh user@your-server
uname -srm
id
systemctl --version
command -v roost || true
ss -lnt
```

Expect Linux and `x86_64`. Verify sudo access and free disk space. If Roost is
already installed, inspect `roost server logs` and its installation directory;
use the existing installation or its update command rather than installing a
second copy. The installer supports one service per operating-system user.

Choose a stable non-root account. If the VM's primary disk is ephemeral, mount
a persistent local filesystem before installation and choose a durable
`ROOST_HOME`. Its release and data directories must stay on the same filesystem.
Retain the account's Codex home too; it lives outside `ROOST_HOME` by default.

## 2. Install a release

Follow [Installation](install.md#install-from-a-github-release): choose an exact
published version, download and inspect its installer, and run it as the chosen
account. The installer provides Node and Codex and creates a systemd service
running as that account. It uses sudo for service management.

Do not use the packaged installer on ARM, macOS, or a container that does not
run systemd. [Development](development.md) describes source builds; those require
separately provisioned, compatible Node and Codex runtimes.

## 3. Open a private connection

Roost listens on `127.0.0.1:3000` unless a different port was selected during
setup. From your own computer, keep this tunnel running:

```sh
ssh -N -L 3003:127.0.0.1:3000 user@your-server
```

Open `http://127.0.0.1:3003`. Choose another local port if `3003` is already in
use. Keep the service's remote port on loopback; opening it in a public firewall
does not add authentication.

For access without an SSH tunnel, use a TLS reverse proxy that authenticates
every HTTP and WebSocket request. Prevent direct access around that proxy.
Do not publish a plain reverse-proxy route to Roost before adding authentication.

## 4. Connect and verify

Open **Settings → Connect Codex**, then create your first agent. Check the server
from the SSH session:

```sh
roost server logs
curl --fail http://127.0.0.1:3000/api/health
```

Run the [deployment acceptance checks](deployment.md#acceptance-checks-for-every-platform),
including a workspace tool call, a scheduled task while the browser is closed,
and a service restart with data preserved.

## 5. Add a shared desktop when needed

Use an existing X11 desktop owned by the same account, or follow
[Remote desktop setup](remote-desktop-setup.md). Then configure
[Shared computer](computer.md#linux-configuration), using the exact origin you
open in your browser. For the tunnel above that is `http://127.0.0.1:3003`.

The VNC listener stays on the server's loopback interface. Protect its HTTP and
WebSocket routes through the same private access route as Roost. Closing the
viewer should leave the desktop and browser profile intact.

## Operate the installation

```sh
roost server logs --follow
roost server stop
roost server start
roost update
```

Run stop/start only when intended; stopping interrupts active work. See
[updates and recovery](install.md#update). Keep the machine powered on for
schedules, maintain OS/browser security updates, and back up the entire app data
directory plus the host's Codex configuration securely. Rebooting is different
from deleting/recreating a server and its disk.
