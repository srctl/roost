# Run Roost on macOS

Run a source build on your Mac, then use a per-user LaunchAgent to keep its
server running after Terminal closes. The packaged `roost setup`, `roost server`,
and `roost update` commands currently target Linux x64 with systemd; they are
not the macOS installation path.

Chat, files, schedules, and dashboards can use the local server. Roost's shared
computer adapter currently needs Linux X11, so this guide does not enable Mac
screen control. For an always-on host with a shared browser, use
[exe.dev](deploy-exe-dev.md) or another compatible Linux machine.

A LaunchAgent starts when you log in and stops when you log out. Roost also stops
making progress while the Mac sleeps. Keeping Terminal closed is different from
keeping the machine awake. [Apple's launchd lifecycle](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

## 1. Check prerequisites and existing installs

Use your normal macOS account, not root:

```sh
sw_vers
uname -m
node --version
corepack --version
codex --version
git --version
lsof -nP -iTCP:3000 -sTCP:LISTEN
launchctl print "gui/$(id -u)/dev.roost.server"
```

An absent listener or service is normal on a new installation. If either is
present, inspect it before creating anything. Do not stop an unrelated process
to free a port.

Roost requires Node.js 22.13 or later and pnpm 9.15.0. Node 24 LTS is a suitable
choice for a new installation. Install missing prerequisites from
[Node.js](https://nodejs.org/en/download),
[Corepack](https://github.com/nodejs/corepack#how-to-install), and the
[official Codex CLI guide](https://learn.chatgpt.com/docs/codex/cli#install-codex).
Use the existing working tools when available. Corepack selects the pnpm version
from Roost's `package.json`.

## 2. Build a dedicated checkout

Keep the following variables in the same terminal session. Change the paths if
you already have an installation; do not silently switch it to an empty data
directory.

```sh
export ROOST_CHECKOUT="$HOME/Applications/roost"
export ROOST_DATA_DIR="$HOME/Library/Application Support/Roost"
export ROOST_CODEX_BINARY="$(command -v codex)"
ROOST_NODE="$(node -p process.execPath)"
ROOST_HOST_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
ROOST_PLIST="$HOME/Library/LaunchAgents/dev.roost.server.plist"
ROOST_LOG_DIR="$HOME/Library/Logs/Roost"
```

`ROOST_NODE` and `ROOST_CODEX_BINARY` must name absolute executable files. If
`codex` is a shell alias or function, use its actual executable path. Launchd
does not load your shell configuration or expand `~` in a plist.

Clone only if the chosen checkout does not exist:

```sh
if [ -e "$ROOST_CHECKOUT" ]; then
  git -C "$ROOST_CHECKOUT" remote -v
  git -C "$ROOST_CHECKOUT" status --short
else
  mkdir -p "$(dirname "$ROOST_CHECKOUT")"
  git clone https://github.com/srctl/roost.git "$ROOST_CHECKOUT"
fi
```

If the existing directory is a different repository or has unrelated changes,
choose a new path. For reproducible installs, select a published Roost release
tag before building and record the commit. Do not reset an existing checkout.

In the confirmed checkout:

```sh
cd "$ROOST_CHECKOUT"
```

If `node_modules` is absent, install dependencies:

```sh
corepack pnpm install --offline --frozen-lockfile
```

Retry without `--offline` only if required packages or metadata are missing from
the local store. If `node_modules` exists and the manifest/lockfile are unchanged,
skip installation. Network or DNS failures are transport problems, not a reason
to replace the lockfile.

```sh
corepack pnpm check
```

This runs the project's checks and builds `.output/server/index.mjs`.

## 3. Confirm the app works in the foreground

Start the production server with a stable data directory and a private listener:

```sh
HOST=127.0.0.1 PORT=3000 "$ROOST_NODE" "$ROOST_CHECKOUT/.output/server/index.mjs"
```

In another terminal, run:

```sh
curl -fsS http://127.0.0.1:3000/api/health
```

Expect `{"status":"ok","version":"dev"}` for a source build. Open
`http://127.0.0.1:3000`, connect Codex in Settings, create an agent, and complete a
small task. Reload to check persistence. The health response checks SQLite and
HTTP, not Codex authentication or task completion.

Roost requires file-based Codex credentials under the same user's Codex home.
If the existing CLI login is keyring-only, use this in your regular terminal:

```sh
codex login -c cli_auth_credentials_store='"file"'
```

Do not print or copy `auth.json`. Its contents are credentials.
[Codex credential storage](https://learn.chatgpt.com/docs/auth#credential-storage).

Stop the foreground server with Ctrl-C before starting the LaunchAgent. Let
active work finish first or stop it deliberately in Roost.

## 4. Create the LaunchAgent

This creates only a new `dev.roost.server` plist and refuses to overwrite one.
It uses absolute paths captured above, including the current executable and
Codex home. Apple documents `ProgramArguments`, per-user LaunchAgents, and
`KeepAlive`; current command details are available in `man launchctl` and
`man launchd.plist`. [Apple launchd guide](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).

```sh
(
  set -eu
  test -x "$ROOST_NODE"
  test -x "$ROOST_CODEX_BINARY"
  test -f "$ROOST_CHECKOUT/.output/server/index.mjs"
  if [ -e "$ROOST_PLIST" ]; then
    printf '%s\n' 'LaunchAgent already exists; inspect it instead of overwriting it.'
    exit 1
  fi
  umask 077
  mkdir -p "$(dirname "$ROOST_PLIST")" "$ROOST_LOG_DIR" "$ROOST_DATA_DIR"
  plutil -create xml1 "$ROOST_PLIST"
  plutil -insert Label -string dev.roost.server "$ROOST_PLIST"
  plutil -insert ProgramArguments -array "$ROOST_PLIST"
  plutil -insert ProgramArguments.0 -string "$ROOST_NODE" "$ROOST_PLIST"
  plutil -insert ProgramArguments.1 -string "$ROOST_CHECKOUT/.output/server/index.mjs" "$ROOST_PLIST"
  plutil -insert WorkingDirectory -string "$ROOST_CHECKOUT" "$ROOST_PLIST"
  plutil -insert EnvironmentVariables -dictionary "$ROOST_PLIST"
  plutil -insert EnvironmentVariables.HOST -string 127.0.0.1 "$ROOST_PLIST"
  plutil -insert EnvironmentVariables.PORT -string 3000 "$ROOST_PLIST"
  plutil -insert EnvironmentVariables.ROOST_DATA_DIR -string "$ROOST_DATA_DIR" "$ROOST_PLIST"
  plutil -insert EnvironmentVariables.ROOST_CODEX_BINARY -string "$ROOST_CODEX_BINARY" "$ROOST_PLIST"
  plutil -insert EnvironmentVariables.CODEX_HOME -string "$ROOST_HOST_CODEX_HOME" "$ROOST_PLIST"
  plutil -insert EnvironmentVariables.PATH -string "$PATH" "$ROOST_PLIST"
  plutil -insert KeepAlive -bool true "$ROOST_PLIST"
  plutil -insert ExitTimeOut -integer 90 "$ROOST_PLIST"
  plutil -insert Umask -integer 63 "$ROOST_PLIST"
  plutil -insert StandardOutPath -string "$ROOST_LOG_DIR/server.log" "$ROOST_PLIST"
  plutil -insert StandardErrorPath -string "$ROOST_LOG_DIR/error.log" "$ROOST_PLIST"
  plutil -lint "$ROOST_PLIST"
)
```

If this stops halfway through, inspect the newly created plist and repair or
remove only that incomplete file before retrying. Review it with
`plutil -p "$ROOST_PLIST"`. `PATH` is captured so agents can find installed tools;
review it if your shell adds project-specific entries. The decimal umask `63`
corresponds to `077`.

Load it from your logged-in desktop session:

```sh
launchctl enable "gui/$(id -u)/dev.roost.server"
launchctl bootstrap "gui/$(id -u)" "$ROOST_PLIST"
launchctl print "gui/$(id -u)/dev.roost.server"
curl -fsS http://127.0.0.1:3000/api/health
```

Only bootstrap when the service is not already loaded. Verify the app again,
then close Terminal and reopen Roost in your browser. A successful plist syntax
check alone does not prove the server or Codex works.

## Daily operation

Inspect logs:

```sh
tail -n 100 "$HOME/Library/Logs/Roost/server.log" "$HOME/Library/Logs/Roost/error.log"
```

Stop for maintenance:

```sh
launchctl bootout "gui/$(id -u)/dev.roost.server"
```

Start again using the existing plist:

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.roost.server.plist"
```

For a deliberate immediate restart of a loaded service:

```sh
launchctl kickstart -k "gui/$(id -u)/dev.roost.server"
```

Restarting interrupts active work. To keep it disabled across logins, use
`launchctl disable "gui/$(id -u)/dev.roost.server"` and boot it out if loaded.
Re-enable it before bootstrapping again. KeepAlive restarts a stopped process,
so use `bootout` rather than killing the Node PID for maintenance.

## Updates and backups

Source installs have no automatic update rollback. Before changing the checkout,
let active runs finish, boot out the service, and confirm port 3000 is no longer
served by that Roost process. Keep a backup outside the app data directory:

```sh
(
  set -eu
  ROOST_BACKUP="$HOME/roost-backup-$(date +%Y%m%d-%H%M%S)"
  umask 077
  mkdir "$ROOST_BACKUP"
  ditto "$ROOST_DATA_DIR" "$ROOST_BACKUP/data"
  if [ -d "$ROOST_HOST_CODEX_HOME" ]; then
    ditto "$ROOST_HOST_CODEX_HOME" "$ROOST_BACKUP/codex-host"
  fi
  ditto "$ROOST_CHECKOUT/.output" "$ROOST_BACKUP/output"
  cp "$ROOST_PLIST" "$ROOST_BACKUP/dev.roost.server.plist"
  git -C "$ROOST_CHECKOUT" rev-parse HEAD > "$ROOST_BACKUP/commit.txt"
  printf '%s\n' "$ROOST_BACKUP"
)
```

Keep a protected off-device copy; it includes login credentials. The data directory
contains conversations, files, souls, and agent memory; `codex-host` preserves the
separate host login and configuration. After a
successful backup, inspect `git status`, fetch the intended release, and switch
only a clean deployment checkout to that tag. Install dependencies only when
needed, run `corepack pnpm check`, then bootstrap and verify health plus a task.

If the new version fails, boot it out, preserve the failed data for diagnosis,
and restore the matching saved `.output` and complete data directory before
restarting. Do not run the old build against data migrated by the new build.
Changes to external services cannot be rolled back by restoring local files.
Update the plist if a Node/Codex upgrade changes either executable path.

## Agent handoff checklist

- Record the checkout and commit, Node/Codex executable paths, data directory,
  Codex home path, LaunchAgent label, listener, and log paths. Omit credentials.
- Preserve existing checkouts, data, running services, and tool installations.
- Verify plist syntax, the loaded service, loopback health, one completed agent
  task, and persistence after reopening the browser.
- Report which checks remain, how to stop/start the server, and where backups
  are stored. State that logout and sleep stop unattended progress, and that
  Roost's computer adapter remains Linux-only.
