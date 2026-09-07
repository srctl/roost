# Choose where to run Roost

For a persistent Roost installation, **start with [exe.dev](deploy-exe-dev.md)**.
Its persistent Linux machine and private HTTPS proxy fit Roost's current design.
A Linux x64 VPS is another straightforward option. Use macOS when you want Roost
on your own Mac and are comfortable keeping that Mac awake.

Roost has two different hosting needs: the **private app** runs agents and stores
their data; the **public websites** are static marketing and documentation files.
They can live on different providers. Publishing the websites does not run agents.

## Pick a platform

| Platform and guide | Running the app | Shared computer |
| --- | --- | --- |
| [exe.dev](deploy-exe-dev.md) | Recommended persistent VM route | Add the Linux X11 desktop |
| [Linux](deploy-linux.md) | Packaged install on an x64 VM or home server with systemd | Add an X11 desktop |
| [macOS](deploy-macos.md) | Source build with a per-user background service | Linux-only adapter; unavailable on macOS |
| [Railway](deploy-railway.md) | Custom runtime, volume, sandbox verification, and private access required | Custom container work |
| [Vercel](deploy-vercel.md) | Public websites only; incompatible with the current app | Not applicable |
| [Other containers](#other-container-hosts) | Custom image and runtime validation required | Host-specific work |

For the two public websites, [Vercel](deploy-vercel.md) or another static host
can serve the generated files independently of the app.

The VM recommendation is based on Roost's architecture and the provider's
[persistent filesystem](https://exe.dev/docs/serverful) and
[private proxy](https://exe.dev/docs/proxy). Platform guides were checked against
the source and official platform documentation in September 2026. Writing these
guides did not deploy or test a fresh Roost installation on every platform.

## Requirements the app cannot skip

1. **A continuously running Node process.** Node.js 22.13+ runs the app and its
   in-process queue worker. There is no separate cloud scheduler. Disable sleep
   or scale-to-zero when scheduled work matters.
2. **A compatible Codex executable and child processes.** The server launches
   `codex app-server` over standard input/output. A successful web build does
   not prove Codex can launch or execute a tool in its sandbox.
3. **Durable, writable local storage.** Preserve the entire `ROOST_DATA_DIR`,
   including SQLite, agent homes, workspaces, files, and memory. Preserve the
   host Codex credential/configuration directory separately. An object-storage
   bucket does not replace the local SQLite directory.
4. **One active app instance per data directory.** Do not scale this SQLite
   installation into independent replicas or attach a copied database to a
   second worker. Separate installations need separate data and schedules.
5. **Private HTTP and WebSocket access.** Roost has no application-level
   authentication. An internet-facing hostname alone is not an access boundary.
   Use an SSH tunnel or an authenticating proxy, with no public route around it.
6. **An optional Linux X11 desktop.** Browser/computer use additionally needs
   the desktop packages, persistent browser profile, and loopback VNC listener
   described in [Shared computer](computer.md).

The packaged Linux CLI manages its own runtime paths and service. Source builds
use these settings:

| Setting | Purpose |
| --- | --- |
| `HOST` / `PORT` | Listener address and port; default to private loopback when operating directly |
| `ROOST_DATA_DIR` | Absolute path to persistent app data; default is `.roost` relative to the working directory |
| `ROOST_CODEX_BINARY` | Absolute path to the Codex executable, or resolve `codex` through a deliberate service `PATH` |
| `CODEX_HOME` | Host Codex login/config directory; by default the service user's `~/.codex` |
| `ROOST_DESKTOP_DISPLAY` | X11 display such as `:1`; desktop feature only |
| `ROOST_DESKTOP_ORIGIN` | Exact browser-facing origin, including scheme and any nondefault port; desktop feature only |
| `ROOST_DESKTOP_VNC_PORT` | Loopback VNC port; defaults to `5901` |

Use explicit service paths. A background service does not inherit the same shell
initialization as your terminal. Do not inherit another coding agent's private
Codex home as the Roost installation's host login directory.

## Acceptance checks for every platform

These checks distinguish a working web page from working agents:

1. Verify the intended host, OS, architecture, process owner, and persistent
   paths. Check for an existing installation before creating a new one.
2. Check `GET /api/health` through the intended access route. Expect HTTP 200,
   `status: "ok"`, and either the packaged release version or `dev` for a source
   build. This proves HTTP and database access only.
3. Confirm an unauthenticated remote visitor cannot reach the app, files, or
   desktop WebSocket route. A redirect to the authentication provider is fine.
4. Connect Codex interactively, create a test agent, and ask it to write a small
   file inside its workspace and read it back. Verify that an actual sandboxed
   tool ran; a text-only response does not prove execution works.
5. Schedule a one-time, harmless task a few minutes ahead. Close the browser,
   reopen it after that time, and check the run and output. Remove that test
   schedule after verification.
6. Restart the service when no real work is active. Confirm the test agent,
   files, conversation, and Codex login survive. Run another harmless task.
7. If configured, check the live desktop, take/return control, and reconnect.
   Verify you are using the intended persistent browser profile.

Record the tested platform, release or source revision, private URL, service
name, persistent paths, and checks that actually passed. Do not report a
deployment as complete merely because a build, upload, or health check succeeded.

## Updates and backups

Packaged installations use `roost update`; see [Installation](install.md#update)
for backup and rollback behavior. For source/container installations, stop new
work and wait for active tasks to finish before stopping the service. Back up
the full data directory while the app is stopped, and preserve host credentials
securely. A copy of only `roost.sqlite` may miss workspaces and SQLite journal
state.

Keep the previous application revision with its matching backup. Do not run an
old app against a newer database after a failed upgrade. Service restarts mark
in-flight work interrupted; Roost does not automatically repeat it. Never delete
a VM or volume as a way to restart or update it.

## Other container hosts

Fly Machines and Render paid services offer persistent storage, but this repo
does not include a tested Roost container image. Treat them as custom deployment
work, not a one-click alternative to the Linux installer:

- On **Fly**, mount a persistent volume for both app data and the host Codex
  home, keep one Machine, and disable automatic stopping. Fly's proxy can treat
  a background worker as idle even while it is busy. Use an authenticated
  private-access route. See [long-running tasks](https://fly.io/docs/blueprints/long-running-tasks/)
  and [volumes](https://fly.io/docs/volumes/overview/).
- On **Render**, select a service with a persistent disk and keep every durable
  path under its mount. A disk is attached to one instance and affects deployment
  behavior; filesystem writes outside it are ephemeral. See
  [persistent disks](https://render.com/docs/disks).

For either provider, first implement a reproducible image containing the app,
Node, a compatible Codex executable, and required sandbox/runtime utilities.
Verify the workspace-write sandbox on the actual host without disabling it.
Set the foreground start command to `node .output/server/index.mjs`, persist
login state, establish private access, and run every acceptance check above.
Do not use `roost setup` inside a container without systemd. A successful
container build alone is not a verified deployment recipe.

For additional **static** hosts, any provider that serves directory indexes and
ordinary text files can serve the website outputs. Follow
[Public websites](public-sites.md), and verify `/llms.txt`, `/llms-full.txt`, and
the individual Markdown URLs along with the HTML pages.
