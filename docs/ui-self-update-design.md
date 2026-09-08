# UI-initiated self-updates: design and feasibility

Status: proposed; documentation only. Source baseline: `f966874` (Roost 0.1.39).
Reviewed 2026-09-08. This document describes future behavior unless explicitly
identified as current. It does not enable updates or change host configuration.

## Recommendation

UI-initiated updates are feasible for packaged Linux x64 installations, using
much of the existing CLI release machinery. Add an independently supervised
updater, a durable operation journal, and explicit human authorization. Keep
Roost unavailable for writes between the final snapshot and commit. Recover the
previous release **and matching data** if candidate startup fails.

The promise should be “update, reconnect, and recover automatically from tested
startup failures,” with a visible manual-recovery outcome. Zero downtime,
universal crash recovery, and “cannot break” are not defensible guarantees.
A button that launches today's `roost update` inside the web service is unsafe:
it needs interactive sudo, and stopping that service can kill its updater.

Assumptions: one installation and service per OS user; local persistent storage;
a trusted release publisher; operators can perform a one-time terminal setup
upgrade. Initial UI activation requires native passkey authentication. Proxy-only
and unauthenticated tunnel users retain the CLI until a separate administrative
authorization mechanism is designed. No automatic installation on a timer.

## Verified current behavior

References below point to source at the baseline, not claims inferred from the
running host. No live update, restart, storage inspection, or installer was run.

| Area | Current implementation and implications |
| --- | --- |
| Installation | [Installer](../scripts/install.sh), [CLI](../src/cli/main.ts), and [service definition](../src/cli/service.ts) accept Linux x64, reject root execution, use sudo to install a system service `roost-<uid>.service`, and select `ROOST_HOME` (default `~/.local/share/roost`). `config.json` records root/user/UID/home/port/repository; `current` selects a release. `server run` fixes loopback binding, bundled Codex, data directory, and release version. |
| Packaging | [Packaging script](../scripts/package-release.mjs), [file copier/validator](../scripts/release-files.mjs), [runtime pins](../scripts/runtime-versions.json), and [release workflow](../.github/workflows/release.yml) build one `roost-linux-x64.tar.gz`, `SHA256SUMS`, and installer. Node 24.15.0 and Codex 0.153.4 archives have pinned hashes. CI runs `pnpm check`, builds a draft release with assets, then publishes it. There is no signing/attestation verification step in this workflow or downloader. |
| Verification | [Release functions](../src/cli/releases.ts) use the configured GitHub repository's latest release or exact `vX.Y.Z` tag; require its API asset SHA-256 digest; check archive paths and reject links/special files before extraction; validate manifest and required files; require tag/manifest agreement. The shell installer instead verifies downloaded `SHA256SUMS` and extracts directly, without those archive checks. Neither path verifies an independent publisher signature. |
| CLI transaction | [Update command](../src/cli/main.ts) holds the [operation lock](../src/cli/state.ts), stages/downloads, rejects downgrades, installs a new release directory, obtains sudo, and calls [applyUpdate](../src/cli/update.ts). That enables maintenance, waits up to five minutes for `runs.status='running'`, stops the service, copies `data`, atomically switches `current`, starts, and checks health. A previously stopped installation is stopped again after successful verification. |
| Recovery today | `applyUpdate` attempts to stop the candidate, preserve failed data, restore the snapshot and old pointer, and restart the old service when previously running. It removes a failed candidate on successful recovery. Recovery failure leaves maintenance enabled. The exclusive-create PID lock has no automatic stale-lock recovery or durable phase journal. SIGINT/SIGTERM request cancellation, but download/service calls do not all honor that signal; SIGKILL/power loss require [manual recovery](install.md#recovering-after-a-hard-interruption). |
| Lifecycle | The service uses `Restart=on-failure`, `KillMode=control-group`, and `TimeoutStopSec=90`. [Nitro close hook](../src/server/worker-plugin.ts) stops workers, login, and agent runtimes. [Worker shutdown](../src/server/runs/worker.server.ts) aborts controllers, waits for tasks, and releases its lease. Graceful close is not proof that every external worker or action has stopped. |
| Health | [`GET /api/health`](../src/routes/api.health.ts) opens the agent store (which can migrate it), runs `SELECT 1`, and returns version. [CLI health polling](../src/cli/service.ts) checks that version for up to 60 attempts, with one-second fetch timeouts and 500 ms delays. This is not a fixed 30-second deadline and does not establish auth, assets, scheduler, or Codex readiness. |
| UI/auth | [Settings](../src/routes/settings.tsx) and its [navigation registry](../src/features/settings/navigation.ts) have no update flow. [HTTP auth](../src/server/auth/http.server.ts) is optional: when unconfigured it permits normal app traffic. When configured it checks host, mutating request origin, session, and some Fetch Metadata; health stays public. [Cookies](../src/server/auth/session.server.ts) are Secure, HttpOnly, SameSite=Strict. Auth-management actions already use a five-minute recent-session check; there is no updater-specific authorization. |
| Storage | [Agent store](../src/server/agents/store.server.ts) migrates `roost.sqlite` on open through `PRAGMA user_version=10` and rejects higher versions. [Auth store](../src/server/auth/store.server.ts) separately creates `auth.sqlite` tables; it has no equivalent versioned migration contract. Release manifest `schema: 1` validates the bundle format, **not** database compatibility. [Backup documentation](install.md#back-up-a-packaged-installation) distinguishes app data from external Codex credentials/configuration and browser profiles. |
| Admission/draining | [Maintenance](../src/server/maintenance.server.ts) and [availability middleware](../src/server/available.ts) gate covered operations. [Run store](../src/server/runs/store.server.ts) gates claims and scheduled work; its steering claim has no direct maintenance predicate. CLI counting excludes `steering` and all `coding_jobs`. Maintenance is not a universal barrier against every data writer, including auth and already-running work. |
| Jobs/schedules | [Scheduler](../src/server/runs/store.server.ts) maintains a 30-second worker lease, marks abandoned running/steering runs interrupted without replay, and coalesces missed automation occurrences into one catch-up when applicable. [Coding worker](../src/server/coding/worker.server.ts) skips its selection/polling in maintenance; on recovery, uncertain launches/submissions are blocked rather than resent. It monitors [Herdr sessions](../src/server/coding/herdr.server.ts), which may be remote. App process exit is not evidence those sessions stopped. |

Existing [release tests](../tests/releases.test.ts) cover checksum/path rejection,
locking, migrations, maintenance for runs/schedules, and rollback with fake
service controls. [Packaging tests](../tests/release-packaging.test.ts) check
archive handling. These are useful starting points, not systemd/crash-safety or
coding-job-drain certification.

## Supported installation matrix

| Installation | Initial UI behavior | Activation prerequisite or alternative |
| --- | --- | --- |
| Official packaged Linux x64, systemd, persistent local filesystem | Supported after updater enrollment | Validate config, UID, canonical paths, unit identity, runtime execution, disk space, and updater protocol; require native passkey auth. |
| Same package on an exe.dev VM | Same support, conditional on the same prerequisites | Existing documented proxy/tunnel remains in place; updater does not reconfigure hosting or proxy access. No exe.dev-specific control API is needed. |
| Existing 0.1.39 package without updater service | Show setup required | One terminal setup/enrollment operation installs the reviewed helper and narrowly scoped service-control policy. A normal UI request cannot grant itself privileges. |
| Locally built package or alternate/private GitHub repository | Conditional, explicitly enrolled | Same validated bundle contract and trusted repository; a private repository needs a separately configured read-only credential for the updater. A shell's `GH_TOKEN` is not inherited automatically by systemd. |
| Source checkout, including Linux development and macOS LaunchAgent | Show externally managed | Operator pulls/builds/restarts; do not overwrite source, worktrees, or development dependencies. |
| Railway Cloud Agent VM using the documented source-build/supervisor path | Show externally managed | The tested VM lacked systemd; operator rebuilds/restarts the source deployment. |
| Containers or other orchestrated app deploys | Show externally managed | Deployment platform replaces the image/build and owns rollback. No in-container self-modification. |
| Vercel public marketing/docs sites | Not applicable | These are static websites, not the Roost server or an updater target. |
| ARM, Windows, non-systemd Linux, network/ephemeral install storage | Unsupported for initial activation | Need separate artifacts/lifecycle adapters and durability qualification. Detection must provide a specific reason. |

The repository's [Linux](deploy-linux.md), [macOS](deploy-macos.md),
[Railway](deploy-railway.md), and [Vercel](deploy-vercel.md) guides describe distinct
deployment paths. “Linux x64” alone does not prove ABI/runtime compatibility;
qualify Ubuntu 24.04 first (the release builder), then explicitly test additional
distributions. Do not infer supported distributions from the tarball name.

## Execution boundary and durable ownership

Use a separate systemd updater service running as the installation user, outside
Roost's control group, with a private Unix socket. Pin its executable/runtime to
a retained installed version rather than resolving `current` midway through an
operation. Let it acquire the shared installation lock and own every transition.
Keep this helper's protocol versioned; upgrading the helper itself is initially
an operator setup action, not part of application activation.

A one-time privileged enrollment installs root-owned unit/policy files. Permit
the installation user only fixed start/stop operations for its exact Roost unit
through an audited noninteractive broker/policy. Never grant arbitrary
`systemctl`, unit editing, shell execution, executable paths, or sudo passwords
to HTTP requests. Downloads, extraction, migrations, and application code run
unprivileged. A separate service by itself does not confer permission to stop
another system service.

This separation is necessary because systemd's `control-group` kill mode targets
remaining processes in the service group; `nohup`/detached spawn is insufficient.
An explicit stop also does not invoke the service's failure restart policy.
See systemd's primary [kill-mode documentation](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.kill.xml)
and [service restart documentation](https://raw.githubusercontent.com/systemd/systemd/main/man/systemd.service.xml).

Persist an operation record under `ROOST_HOME/updates/<id>/`, **outside** restored
`data`: protocol version, sequence, actor/session digest, idempotency key, pinned
repository/release/asset IDs and digest, old/new paths, previous service state,
phase/deadline, snapshot manifest, error, and recovery result. Use restrictive
permissions, atomic replacement, and fsync of records and parent directories.
Never log credentials. Boot recovery reads this journal before allowing Roost
to serve mutable traffic. A root-owned service ordering arrangement must start
recovery before Roost; an app startup guard must also reject an unresolved
activation if launched manually. Only a helper-issued operation capability may
start the candidate in verification mode while this gate is held.

Replace PID-file-only ownership with a kernel-held local lock shared by CLI
setup/update/start/stop and the updater. Record PID plus boot/process identity
for diagnostics; never unlink a lock just because its age exceeds a timeout.
Enrollment must fence old CLIs: retain a compatibility `operation.lock` sentinel
so their exclusive-create lock fails, while new clients use the helper and kernel
lock. Document that this sentinel is not a stale PID file to delete. A protocol
marker alone cannot fence binaries that do not understand it; two independent
lock implementations would be unsafe.
External operator `systemctl`/filesystem changes remain outside this contract.
The shared OS user is a trust boundary: agents with arbitrary host execution
already have access to that user's files/socket; UI security cannot isolate a
malicious same-user process.

```text
Browser -- authenticated request --> Roost API -- private socket --> Updater
   |                                    |                          |
   | poll operation ID                  |                          | lock + journal
   |                                    X service stops            | snapshot + switch
   | transient disconnect                                          | start + probe
   +---------------- reconnect --> Roost API <--- durable result ---+
```

## Request security and UX

Add a searchable **Settings → Updates** section, reporting running version,
latest compatible stable version, last check time, release notes, and capability
reason. Escape/sanitize remote release notes. Distinguish “check failed” from
“up to date.” “Newest” means the configured repository's published stable release
that passes compatibility and numeric version checks, not arbitrary tags or
prereleases. GitHub's [release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
provides latest-release metadata and asset digests; pin the selected identity
so later publication cannot change what the user approved.

Proposed API contract (new, not current endpoints):

| Request | Behavior |
| --- | --- |
| `GET /api/updates` | Authenticated, no-store capability, cached metadata, and current operation summary; never activates. |
| `POST /api/updates/check` | Explicit rate-limited metadata refresh; bounded network timeout and cached ETag/backoff. |
| `POST /api/updates` | Recent native passkey session, CSRF token, confirmed server-issued offer ID and idempotency key. Returns `202` only after durable acceptance by updater. |
| `GET /api/updates/:id` | Authenticated, no-store sanitized progress/result. Other tabs and reconnecting clients read the same durable record. |
| `POST /api/updates/:id/cancel` | Same authorization; accepted only before stopping/snapshotting. Idempotent; never interprets a lost connection as cancellation. |

Validate exact configured origin and host; reject missing/unexpected Origin on
mutations, reject cross-site Fetch Metadata, require JSON and a session-bound
CSRF token, disable cross-origin access, bound bodies, rate-limit checks and
starts. Do not expose arbitrary URL, repository, path, command, or unit fields.
Health remains a minimal public liveness endpoint, not an update trigger. The
updater independently checks its peer UID, enrollment, offer, installation, and
lock. Native login is mandatory for activation even when the surrounding app
is served through a trusted proxy. A click confirms the exact version and brief
outage; recent authentication is required at acceptance. Authorization is
consumed for that operation, so session expiry while restarting does not abort
recovery. These controls follow [OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html);
SameSite cookies alone are not the authorization design.

Visible states: unavailable/setup required, checking, up to date, update
available, downloading, verifying, waiting for work, backing up, restarting,
reconnecting, succeeded, cancelled, failed with old version restored, and
manual recovery required. Show phase and bytes when known, not fabricated
percentages. Confirmation explains that external actions cannot be undone.
No force-stop option in the first release. Busy/uncertain work defers the update;
report blockers and allow retry. Do not silently schedule a future restart.

Retain the operation ID and unsubmitted drafts locally; poll with bounded
exponential backoff/jitter during restart. A timeout means “still reconnecting,”
not “update failed.” After reconnect, fetch the operation result and running
version, reauthenticate if needed, then reload versioned assets once. Reconnect
streams by fetching persisted state; never replay prompts or update POSTs merely
because a response was lost. Preserve the route and offer a manual reload.
Other tabs show the same maintenance notice and disable mutations. Mobile uses
the same flow with accessible status announcements and keyboard/focus handling.

## Transaction and recovery sequence

1. **Detect and authorize.** Read installation capabilities and cached metadata.
   Resolve and pin an offer. On confirmation acquire the shared lock, reject
   conflicting operations (`409`), revalidate the offer/version/digest, journal
   acceptance, and return the operation ID. Repeat requests with the same key
   return that operation; changed payloads with that key fail.
2. **Download and stage while serving.** Reuse release validation with bounded
   streaming download, compressed and expanded size/file-count limits, safe
   extraction, no links/special files/path escapes, fixed permissions, and
   network/redirect credential restrictions. Verify digest, tag, manifest,
   platform, required executable files, and migration compatibility. Stage on
   the install filesystem; publish the complete candidate by rename. A digest
   from the same publisher/API detects corruption, not publisher compromise.
   Require a compatible migration contract before activation; signature or
   attestation enforcement can strengthen a later trust policy.
3. **Preflight.** Verify service authority noninteractively, helper compatibility,
   old release validity, data layout, free blocks/inodes for staging plus full
   snapshot and recovery headroom, and writable durable journal. Test bundled
   runtime execution without launching workers. Refuse unknown mounts or external
   writers that invalidate a coherent snapshot. Failure here leaves serving
   unchanged; clean only this operation's owned temporary files.
4. **Drain.** Introduce a distinct draining state: transactionally stop new chat,
   steering, background, delegation, automation, and coding submissions/claims,
   while allowing existing completion, status inspection, and deliberate
   cancellation. Continue coding observation. Wait at most five minutes by
   default; count running and steering runs, in-flight submission/tool tasks,
   coding launches/follow-ups/stops, and observed working or uncertain sessions.
   Review/blocked labels alone do not prove a worker is idle. Recheck under the
   admission barrier before stopping. On timeout/uncertainty restore normal
   admission and mark deferred; retry requires another confirmation.
5. **Stop and snapshot.** Journal stop intent, enter full maintenance (including
   auth/settings writes and every background writer), stop the service, verify
   its group is empty and known external writers are quiescent. Copy complete
   app data, including both SQLite databases and any journal/WAL sidecars plus
   managed workspaces/memory/files; preserve metadata without dereferencing
   links. Record external symlinks/mounts as exclusions or reject unsupported
   mutable layouts. Save config and release identity. Verify snapshot database
   integrity and manifest; fsync and mark complete only after validation. Never
   treat a partial backup directory as a usable snapshot.
6. **Activate and probe.** Journal activation intent with complete snapshot ID,
   switch `current` atomically and durably, start the candidate in a verification
   mode that blocks user mutations, scheduler claims, auth changes, login, and
   external side effects. Probe under a configurable bounded wall-clock budget
   (initially two minutes): expected version/operation identity, database/schema
   integrity, auth-store readability, app shell/assets, listener, and worker
   initialization without executing jobs. Do not require an external model API
   to be online to declare the installation healthy.
7. **Commit.** Journal the durable commit decision before reopening admission;
   clear the gate idempotently and confirm the live result. Queued work resumes;
   retain the previous release and at least the last complete snapshot. A
   previously stopped installation remains stopped for CLI operations. After
   admission reopens, do not automatically restore a snapshot that would discard
   new work. Later runtime failures use normal service restart/operator recovery.
8. **Rollback before commit.** Stop/fence candidate writers, preserve failed data,
   restore a verified snapshot into a separate directory, durably replace data,
   select the previous release, and probe it behind the same gate. Mark rolled
   back before reopening. If recovery fails, keep maintenance, retain evidence,
   and surface journal/backup locations through terminal diagnostics. Never run
   the old executable against migrated candidate data.

SQLite's [backup documentation](https://sqlite.org/backup.html) describes the
consistency requirements for live database copies and its online backup API.
Here, a stopped-writer whole-directory snapshot is chosen because there are two
databases plus related files. An online database backup alone cannot establish
cross-database/filesystem consistency.

Recovery must be idempotent at every intent/completion boundary:

| Last durable evidence after process death/reboot | Recovery rule |
| --- | --- |
| Accepted/downloading/staged, no stop intent | Preserve current release; discard or revalidate partial staging; record failure without auto-retrying installation. |
| Draining/stopping, no complete snapshot | Keep old pointer; verify no activation occurred, reconcile writers, and restart old app behind the gate before cancelling. |
| Complete snapshot, activation intent, no commit | Inspect actual pointer/data and resume rollback to the recorded previous pair; never infer success from pointer alone. |
| Restore in progress | Resume using separate restore directory and journaled rename intents; retain original snapshot untouched. |
| Commit durable, admission release interrupted | Resume candidate and finish opening admission; never roll back a committed operation automatically. |
| Corrupt/missing journal or snapshot, unexpected pointer, failed old-version probe | Fail closed, preserve data, require operator inspection. No guessed snapshot or stale-lock deletion. |

The recovery helper needs a documented read-only status command and explicit
repair procedure independent of the app. Include installation-specific unit,
paths, last phase, matching backup/version, and log access; avoid browser-driven
shell commands. The browser cannot display fresh progress while both app and
proxy route are unavailable; its cached reconnect screen must say so.

## Compatibility and active-work limits

Add an explicit compatibility manifest: bundle format, helper protocol minimum,
app/auth database input ranges and output versions, and data-format/rollback
requirements. Default-deny unknown combinations. Migration code must be
transactional where possible and tested against retained snapshots. Migrations
must not call external services or mutate excluded host data. No down-migrations
are assumed: rollback restores the matching old snapshot.

The snapshot covers managed `data`, not arbitrary coding worktrees, remote
Herdr infrastructure, `~/.codex`, browser profiles, or external tool side effects.
Bundled Codex changes can affect external session/config formats; require a
reviewed compatibility statement or defer those updates to terminal maintenance.
Do not claim full rollback for a release that changes excluded mutable state.
Protect snapshots as secrets; use an explicit retention policy and never delete
the only recovery pair to make space for an update.

Current maintenance halts coding polling, so merely extending `activeRuns()`
would wait on stale job state indefinitely. Split admission blocking from
observation before implementing UI activation. Unknown/missing/identity-changed
workers block activation until inspected; never relaunch a job to “recover” it.
An active coding task that requests an update must receive a deferral, not wait
for an update that is waiting for that same task. Queued jobs stay queued.
Preserve current automation catch-up semantics: one eligible catch-up, not a
replay of every missed interval; schedule windows may expire during downtime.

Even with a successful health gate, later bugs, disk failure, host reboot,
compromised publishers/OS users, independent external writers, or lost network
access can prevent recovery. Same-filesystem rename provides atomic name
replacement, not a transaction spanning files, SQLite, and systemd; durable
journaling and fault-injection tests are essential. No rollback can retract
emails, commits, remote provisioning, or other completed external actions.

## Alternatives and delivery phases

| Alternative | Assessment |
| --- | --- |
| Spawn existing CLI from an HTTP handler | Small change but interactive sudo, control-group death, incomplete drain, and no durable recovery make it unsuitable. |
| Separate supervised updater with shared CLI engine | Recommended: retains existing packaging and service model; costs explicit enrollment, privilege review, journaling, and lifecycle tests. |
| Convert all installs to systemd user services | Could avoid system-service sudo after setup, but changes boot/linger and installation behavior; not necessary for this feature. |
| Container/image deployment controller | Correct for orchestrated installs; larger migration for current packaged users. Keep externally managed. |
| Two live application instances/blue-green | Faster traffic switching, but shared SQLite, worker leases, and external effects make safe concurrent versions much harder. Defer. |

1. **Capability and contract:** extract read-only release detection, capability
   reasons, compatibility schema, and offer model. Add a Settings status surface
   only after reviewed design; no activation. Exit: unsupported installs cannot
   accidentally mutate themselves and checks handle offline/private sources.
2. **Recovery engine and enrollment:** shared locking, separate supervised helper,
   scoped service authority, operation journal, boot gate, coherent snapshots,
   verification mode, and CLI use of the same engine. Exit: isolated VM tests
   prove recovery at each phase boundary and no candidate side effects before
   commit. Implement drain/observation separation as part of this phase.
3. **UI activation:** recent-auth confirmation, CSRF/idempotency, durable status,
   cancel/defer flow, reconnect and accessible mobile UX. Exit: authenticated
   end-to-end update/rollback works with active work and multiple tabs. This UI
   implementation PR must include actual matched before/after desktop/mobile
   screenshots; this design-only PR has no applicable UI screenshots.
4. **Broaden after evidence:** qualify additional distributions, credential
   provisioning, stronger release provenance, retention tooling, and deployment
   adapters. Do not make these prerequisites for the narrowly supported path.

Feasibility is high for phases 1–3 within that bounded platform, but phase 2 is
substantial reliability/security work, not a settings-only feature. Its release
blockers are concrete engineering gates above, not missing product decisions.

## Future verification matrix

| Layer | Meaningful cases and expected invariants |
| --- | --- |
| Release | Offline/429/private-token failure, latest changed after approval, missing/mismatched digest, tag/manifest mismatch, downgrade, bad ABI/protocol/schema, oversized archive, path/link/device-file attacks: no activation or leaked token. |
| Authorization | No auth/proxy-only access, expired/revoked/recent sessions, cross-origin and missing Origin, forged CSRF, GET mutation, arbitrary unit/path/URL, duplicate and conflicting requests: only explicit authorized offers start once. |
| Concurrency | Two tabs, CLI versus UI, setup/start/stop races, stale PID/reused PID/reboot: one owner and no overlapping activation; old CLI enrollment mismatch fails. |
| Work | Chat/steering/tool wait, queued automation, expired schedule, delegation/reflection, coding start/follow-up/cancel race, remote working/unknown/idle session: no new submissions during drain, completions observed, uncertainty defers, no prompt replay. |
| Data | Legacy-to-current schemas, too-new schema, auth sessions, files/souls/workspaces, large data, symlinks/mounts, disk/inode exhaustion, copy failure, SQLite sidecars: coherent snapshot or safe refusal, no old-code/new-data pairing. |
| Lifecycle | Real disposable Ubuntu systemd VM: explicit stop, slow shutdown, orphan process, port collision, bad candidate health/assets/auth, no model network, initially stopped CLI install: verify correct service state and helper survival. |
| Fault injection | SIGKILL and VM reboot before/after every journal write, snapshot completion, pointer/data rename, start, commit, and admission release; corrupt journal and failed rollback: deterministic safe recovery or explicit maintenance, never partial snapshot restore. |
| Browser | Lost acceptance response, network/proxy outage, reload/closed tab, stale assets, multiple tabs, reauth after rollback, mobile and assistive technology: durable result, retained drafts, no repeated mutation, accurate reconnect state. |

## Evidence and review limits

Source review independently checked the files linked above at `f966874`; prior
job findings were not treated as evidence. External primary documentation was
accessed on 2026-09-08. The systemd rendered manual returned HTTP 403, so its
upstream manual source is linked instead. Repository-relative links, Markdown
structure, and whitespace are checked for this document. No application tests,
installer experiments, or live systemd/update operations are needed to validate
this documentation-only change; future runtime feasibility remains subject to
the test matrix. No app UI was changed, so screenshots are not applicable.
