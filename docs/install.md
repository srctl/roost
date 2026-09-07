# Install and operate Roost

The packaged installation supports **Linux x64 with systemd**. It includes its
own Node and Codex runtimes, without replacing system-wide executables. Run
setup as your normal account, not root. You need `curl`, `tar`, `sha256sum`,
`systemctl`, and permission to use `sudo` for service setup.

## Install from a GitHub release

Open [Roost releases](https://github.com/srctl/roost/releases), choose a release,
and download its `install.sh` asset. Inspect the script before running it.
Replace `X.Y.Z` below with that release's exact version, without the `v` prefix:

```sh
sh install.sh srctl/roost X.Y.Z
```

If you are working from source instead of a packaged release, see
[Development](development.md).

The installer downloads that version's archive and verifies `SHA256SUMS` before
running setup. This bootstrap is for public releases. For a private repository,
download the archive and checksum using `gh release download`, verify it with
`sha256sum --check SHA256SUMS`, extract it, and run:

```sh
./bin/roost setup --repository srctl/roost
```

Setup installs into `~/.local/share/roost`, links `~/.local/bin/roost`, and enables
a systemd system service named `roost-<uid>.service`. The service runs as the
installing user and restarts after failure or machine reboot. Setup uses sudo
only to install and manage the service. Ensure `~/.local/bin` is in your PATH.

To install a locally built archive, extract it and run
`./bin/roost setup --skip-login`. You can configure its release source later:

```sh
roost setup --repository srctl/roost --skip-login
```

Setup supports `--port 3000` and `--skip-login`. After installation,
`roost setup --login` starts terminal sign-in.

## Connect Codex

With no existing file-based Codex login, interactive setup starts device
authentication.
For a noninteractive installation, open **Settings → Connect Codex** in the
Roost UI afterward. Copy the device code, open the OpenAI sign-in page, and
enter the code. The connection status updates when sign-in finishes. Use
**Reconnect Codex** if a saved login expires or becomes invalid.

The terminal flow remains available:

```sh
roost setup --login
```

Sign in on the machine running Roost. Credentials stay in that user's Codex
home; installation does not copy credentials or agents from another machine.
The same login serves all agents in this installation.

For a source checkout with a separately installed Codex CLI, authenticate as
the operating-system user running Roost and use file-based credential storage:

```sh
codex login -c cli_auth_credentials_store='"file"'
```

`ROOST_CODEX_BINARY` selects an alternate Codex executable for source builds.
The executable and your account determine which models Roost can offer.
Packaged installations select the bundled executable automatically.

## Server commands

```sh
roost server start
roost server stop
roost server logs
roost server logs --follow
```

Start waits for the HTTP and database health check, and is safe to repeat.
Stop interrupts active work; saved conversations and queued work remain.
Logs shows the last 100 journal entries; `--follow` streams new entries.

Roost binds to `127.0.0.1` only. It currently has no application authentication.
From your computer, forward an available local port:

```sh
ssh -N -L 3003:127.0.0.1:3000 user@your-server
```

Replace `user@your-server` with your SSH destination, then open
`http://127.0.0.1:3003`. A browser on the Roost host can open
`http://127.0.0.1:3000` directly. If you use a reverse proxy instead of SSH, it
must authenticate both HTTP and WebSocket traffic. The public marketing and
docs sites do not require access to this private server.

## Update

```sh
roost update                 # Latest published stable release
roost update --version X.Y.Z # Replace with an exact newer version
```

For private repositories, provide `GH_TOKEN` through your shell environment.
Tokens are used only for GitHub requests, never saved in Roost's configuration.

The updater verifies GitHub's SHA-256 asset digest and the archive's paths and
manifest before changing the running installation. It pauses new requests and
queue claims, waits up to five minutes for active runs, stops the service, and
backs up the entire data directory. Queued work remains queued. An atomic
`current` symlink switch selects the new release. The new server must report
the expected release version and open its database successfully before work
resumes. An installation that was stopped stays stopped after verification.

If startup or health checking fails, Roost restores the old release and data
backup, then restores the previous service state. Failed migration data is
retained in `failed-update-*` for diagnosis. Updating does not roll back external
actions an agent already performed. Downgrades are refused.

```text
~/.local/share/roost/
  config.json         # Port, user, and GitHub repository
  current -> releases/X.Y.Z
  releases/           # Application, CLI, and pinned runtimes per version
  data/               # SQLite, workspaces, souls, and isolated agent memory
  backups/            # Full data snapshots taken with the server stopped
  operation.lock      # Serializes setup, update, start, and stop
```

`ROOST_HOME` can select another installation directory before initial setup.
One service per user is supported. Keep releases and data on the same local
filesystem. Old releases and backups are retained; prune them deliberately
when you no longer need recovery. Backups can contain personal data.

### Recovering after a hard interruption

Normal update errors and SIGINT/SIGTERM attempt rollback. A power loss or SIGKILL
can leave `operation.lock` and maintenance mode set. Recovery is manual:

1. Check the PID in `operation.lock` and confirm no update process is still
   running. Inspect `roost server logs` and the `current` symlink.
2. Stop the service with `sudo systemctl stop roost-$(id -u).service`.
3. If activation or migration was interrupted, preserve the current `data`
   directory for diagnosis. Restore the most recent **complete** pre-update
   backup and point `current` at that backup's previous release. Do not pair an
   old executable with a newer database. An interrupted copy may be incomplete.
4. Remove the stale lock only after checking the process. Clear maintenance in
   the restored database using the installed Node runtime:

   ```sh
   ~/.local/share/roost/current/runtime/node --input-type=module -e '
     import { DatabaseSync } from "node:sqlite";
     const db = new DatabaseSync(process.argv[1]);
     db.exec("UPDATE runtime_control SET maintenance=0 WHERE id=1");
     db.close();
   ' ~/.local/share/roost/data/roost.sqlite
   ```

5. Run `roost server start` and inspect its logs and health response.

## Back up a packaged installation

Automatic update backups contain Roost's app data. The host's `~/.codex` login
and configuration, and any browser profile, live separately.

For a manual backup of the default installation, let active work finish or stop
it deliberately, then run on the Roost host:

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
protected copy off the host because it includes login credentials. Use your
configured paths for custom installations. Back up the browser profile
separately with Chrome stopped if you need its persistent sessions.

Restore matching application and data versions. Never run an old executable
against a database already migrated by a newer version. For migration or update
failures, follow [recovery after an interruption](#recovering-after-a-hard-interruption).

## Release development

See [Development](development.md#build-and-publish-releases) for packaging, pinned
runtimes, and the release workflow.
