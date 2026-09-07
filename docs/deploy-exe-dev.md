# Deploy on exe.dev

exe.dev is a good default for keeping Roost available when your laptop is closed.
It provides a persistent Linux VM and a private HTTPS address, including
WebSocket support. Roost's files and SQLite database stay on that VM.
[Persistent storage](https://exe.dev/docs/serverful),
[HTTPS and WebSockets](https://exe.dev/vps).

Keep Roost private. It has no application login of its own, and everyone granted
access to the app can use the same agents and computer.

## 1. Choose or create a VM

On your computer, connect with `ssh exe.dev` to register or sign in if needed.
Then inspect your existing VMs:

```sh
ssh exe.dev ls --json
```

Reuse the intended VM when it already exists. To create a new, dedicated VM,
replace `roost-home` with an unused name and run this once:

```sh
ssh exe.dev new --name=roost-home --json
```

This uses the default image. Resources depend on your account plan; inspect the
result instead of assuming a particular architecture or capacity. The official
[`new` reference](https://exe.dev/docs/cli-new) describes resource options.

Save the VM name, `ssh_dest`, and `https_url` returned by `ls --json`. Use
`ssh_dest` exactly: it can include a routing username. Do not derive it from the
browser URL. [SSH API response fields](https://exe.dev/docs/api).

```sh
ROOST_VM='roost-home'
ROOST_SSH_DEST='COPY_THE_RETURNED_SSH_DEST'
ssh "$ROOST_SSH_DEST"
```

## 2. Inspect the host and install Roost

Run inside that SSH session:

```sh
uname -sm
id
ps -p 1 -o comm=
command -v curl tar sha256sum systemctl sudo
ss -lnt
```

Continue only with **Linux x86_64**, systemd, a non-root account, and sudo access.
Choose an unused port; this guide uses 3000. The default image supports systemd
services, but custom images may differ. [exe.dev systemd example](https://exe.dev/docs/use-case-gh-action-runner).

Check for an existing installation first:

```sh
ls -ld "$HOME/.local/share/roost" "$HOME/.local/bin/roost" 2>/dev/null
```

If either exists, inspect the installation and use its existing `roost server`
commands. Do not install over an unrelated path or create a second copy. Also
check any custom `ROOST_HOME` previously chosen for this host.

For a new installation, choose a version from
[Roost releases](https://github.com/srctl/roost/releases). Replace `X.Y.Z` with
that exact version, without the `v` prefix:

```sh
ROOST_VERSION='X.Y.Z'
ROOST_DOWNLOAD="$(mktemp -d)"
curl -fL "https://github.com/srctl/roost/releases/download/v${ROOST_VERSION}/install.sh" \
  -o "$ROOST_DOWNLOAD/install.sh"
```

Inspect the downloaded script, then run it as the same non-root user:

```sh
sh "$ROOST_DOWNLOAD/install.sh" srctl/roost "$ROOST_VERSION" --port 3000 --skip-login
```

Setup verifies the release checksum, installs bundled Node/Codex runtimes,
creates a systemd service, and starts Roost on `127.0.0.1:3000`. It does not
replace the VM's existing Codex executable. See [Install and operate Roost](install.md)
for installer behavior, custom paths, and recovery.

Verify inside the VM:

```sh
"$HOME/.local/bin/roost" server start
curl -fsS http://127.0.0.1:3000/api/health
systemctl is-enabled "roost-$(id -u).service"
ss -lnt
```

Expect a health response with `status: "ok"` and the chosen release version, an
enabled service, and a loopback listener. Health checks the HTTP server and
SQLite; it does not prove Codex sign-in or an agent task works.

## 3. Keep the HTTPS proxy private

Return to your computer. Review existing shares and the current proxy port
before changing them, especially on a reused VM:

```sh
ssh exe.dev share show "$ROOST_VM" --json
ssh exe.dev share port "$ROOST_VM"
```

For the dedicated Roost VM, set the target port and private access:

```sh
ssh exe.dev share set-private "$ROOST_VM"
ssh exe.dev share port "$ROOST_VM" 3000
ssh exe.dev share show "$ROOST_VM" --json
```

Changing the proxy port preserves visibility, so explicitly keep it private.
`set-private` retains previously granted users and links: review that access list
as well. Roost cannot separate users inside one installation. [Proxy settings](https://exe.dev/docs/proxy),
[sharing behavior](https://exe.dev/docs/sharing).

Open the returned `https_url`, sign into exe.dev, and confirm Roost loads. Its
proxy can reach a localhost listener; do not change Roost to bind publicly.
If the VM already hosts another app on its default proxy port, leave that route
alone and use its private port-qualified address, such as
`https://YOUR_VM.exe.xyz:3000/`, or an SSH tunnel.
[Localhost deployment](https://exe.dev/docs/migrating-to-exe),
[additional proxy ports](https://exe.dev/docs/proxy#additional-ports).

Check the same address in a signed-out/private browser. It should require
exe.dev authentication rather than display Roost or its health JSON. Do not
use `share set-public` for the private app.

## 4. Connect Codex and the computer

In Roost, open **Settings → Connect Codex** and complete the device sign-in.
Alternatively, run `~/.local/bin/roost setup --login` inside the VM. The user
completes authentication; agents should not copy credentials from another
computer or include device codes in deployment reports. Device-code access may
need enabling in ChatGPT account or workspace settings.
[Codex authentication](https://learn.chatgpt.com/docs/auth#login-on-headless-devices).

Create an agent and send a small task. Confirm its reply completes and remains
after reloading. A working health endpoint alone is insufficient verification.

For browser use, follow [Remote desktop setup](remote-desktop-setup.md), then
[Shared computer](computer.md). Use the same operating-system account as Roost
and set `ROOST_DESKTOP_ORIGIN` to the exact HTTPS origin you use, including a port
if present. Verify the live viewer, **Take control**, **Return control**, and a
harmless agent computer action. Keep VNC/noVNC ports private.

For phone use, configure [push notifications](notifications.md) and
[home-screen installation](mobile.md).

## Stop, restart, update, and back up

Run inside the VM:

```sh
~/.local/bin/roost server logs
~/.local/bin/roost server stop
~/.local/bin/roost server start
~/.local/bin/roost update
```

Run only the operation you need. Stop/start interrupts active work; it is not a
pause. Before maintenance, let runs finish or stop them deliberately. Updates
already create an app data backup and attempt rollback on failed activation;
that automatic backup excludes the host's `~/.codex` credentials and configuration.
See [update and recovery](install.md#update).

For an additional manual backup of the default installation, stop Roost, then
run:

```sh
(
  set -eu
  ~/.local/bin/roost server stop
  ROOST_BACKUP="$HOME/roost-backup-$(date +%Y%m%d-%H%M%S)"
  umask 077
  mkdir "$ROOST_BACKUP"
  cp -a "$HOME/.local/share/roost/data" "$ROOST_BACKUP/data"
  if [ -d "$HOME/.codex" ]; then
    cp -a "$HOME/.codex" "$ROOST_BACKUP/codex-host"
  fi
  cp "$HOME/.local/share/roost/config.json" "$ROOST_BACKUP/config.json"
  readlink "$HOME/.local/share/roost/current" > "$ROOST_BACKUP/release.txt"
  ~/.local/bin/roost server start
  printf '%s\n' "$ROOST_BACKUP"
)
```

A failed copy leaves Roost stopped; resolve the error before restarting. Keep a
protected copy off the VM; it includes login credentials. Use the configured path
for custom installations. Back up the configured browser profile separately with
Chrome stopped if you need its persistent session data. Restore matching application
and data versions; never put an old
executable against a database already migrated by a newer version.

## Agent handoff checklist

- Record the VM name, actual SSH destination, OS/architecture, service user,
  release version, app port, data directory, and private browser URL.
- Reuse existing resources and preserve other services and proxy routes.
- Verify local health, authenticated app access, signed-out denial, and one
  completed Codex task. Record desktop and notification checks separately.
- Report stop/start/update commands, backup location, and any remaining user
  sign-in or verification. Do not report reboot recovery as tested unless a
  deliberate reboot check was actually performed.
