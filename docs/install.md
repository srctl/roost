# Install and operate Roost

The first distribution supports Linux x64 with systemd, including
`roost-dev.exe.xyz`. It includes Node 24.15.0 and Codex 0.153.4. Neither replaces
system-wide executables. Run setup as your normal account, not root.

## Install from a GitHub release

After the repository has a published release, download its `install.sh` asset,
inspect it, and run it with the exact repository and version:

```sh
sh install.sh srctl/roost 0.1.0
```

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

To install a locally built archive before a GitHub repository exists, extract
it and run `./bin/roost setup --skip-login`. Configure the release source later:

```sh
roost setup --repository srctl/roost --skip-login
```

Setup supports `--port 3000`, `--skip-login`, and `--login`. With no existing
file-based Codex login, interactive setup starts device authentication.
For a noninteractive installation, open **Settings → Connect Codex** in the
Roost UI afterward. Copy the device code, open the OpenAI sign-in page, and
enter the code. Roost updates automatically when sign-in finishes. Use
**Reconnect Codex** if a saved login expires or becomes invalid.

The terminal flow remains available:

```sh
roost setup --login
```

Sign in on the machine running Roost. Credentials stay in that user's Codex
home; installation does not copy credentials or agents from another machine.

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
ssh -N -L 3003:127.0.0.1:3000 roost-dev.exe.xyz
```

Then open `http://127.0.0.1:3003`. The remote desktop browser can open
`http://127.0.0.1:3000` directly.

## Update

```sh
roost update                 # Latest published stable release
roost update --version 0.1.1 # An exact newer version
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
  current -> releases/0.1.0
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

## Build and publish

```sh
corepack pnpm check
ROOST_VERSION=0.1.0 ROOST_REPOSITORY=srctl/roost corepack pnpm release:pack
```

Packaging produces `dist/roost-linux-x64.tar.gz`, `SHA256SUMS`, and `install.sh`.
The archive includes application assets, the CLI, pinned runtimes, and license
notices. It excludes `.roost`, source credentials, and the development checkout.
Runtime URLs and trusted checksums are checked into `scripts/runtime-versions.json`.
To change a runtime, verify its official release checksum and update that file.
Set `ROOST_RUNTIME_CACHE` if you want a persistent download cache; a mismatched
cached archive is rejected.

The release workflow runs checks and packaging for a pushed `vX.Y.Z` tag,
creates a draft release, uploads all assets, then publishes it. Enable GitHub's
immutable releases setting on the repository to prevent later replacement.
Roost is distributed under the MIT license. This workflow does not create a repository or publish anything until a tag is pushed.
