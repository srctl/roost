# UI self-updates

This draft implements the supervised update path, enrollment, recovery engine,
and UI. **Activation remains disabled in the shipped helper until the complete
qualification matrix passes.** There is no environment variable, HTTP flag, or
enrollment option that bypasses that build decision. Enrollment installs real
service authority and is an explicit operator action, not an activation bypass.

The implementation starts from `7415789` (0.1.40), including its coding-job
protection and recovery changes. It follows the
[approved design revision](https://github.com/srctl/roost/blob/47093a36a0858e9948e68cba7c403e56ee61425e/docs/ui-self-update-design.md);
[design PR #10](https://github.com/srctl/roost/pull/10) is separate from this PR.

## Initial supported contract

Only explicitly enrolled, packaged Linux x64 installations on Ubuntu 24.04,
systemd and persistent local ext4 storage are candidates for qualification.
The application unit must match Roost's generated unit, with only the updater
startup drop-in. Custom hooks, additional overrides, noncanonical/shared writable
installation paths (the installation root must be mode 0700), externally managed deployments and other service managers
are unsupported. Source installations show their external-management reason in
Settings and cannot activate an update.

Both the previous and candidate packages must include the startup gate and a
compatible `compatibility.json`: updater protocol 1, app/auth schema input ranges
and output versions, complete managed-data snapshots, unchanged excluded state,
and the same bundled Codex version. Packages predating this contract, including
the original 0.1.40 release, need a normal operator-managed upgrade to a gate-aware
release **before enrollment**. Merely adding a manifest to an old binary is unsafe.
Bundled Node and Codex must execute on the host; changed Codex versions require
terminal maintenance and separate compatibility review. No external model API
connection is required for candidate health.

The installation user is a trust boundary. Same-user arbitrary code can access
its installation, data and private helper socket. Independent operator service
changes, external writers and remote effects are outside the recovery guarantee.
Updates cause downtime; they do not provide universal recovery or undo external
actions such as messages, commits or remote provisioning.

## Operator enrollment

Do this only during an authorized maintenance window, using a packaged,
gate-aware release. These commands are documentation, not automatic deployment:

```sh
roost auth setup --origin https://your-roost-host
# Register the native passkey using the private link before relying on UI controls.
roost updates enroll
roost updates status
```

Enrollment verifies installation identity/layout, Python 3 with Linux
`SO_PEERCRED`, systemd, ext4 and the application unit. It requires interactive
operator sudo authorization and installs root-owned files:

* `/etc/systemd/system/roost-UID-updater.service`, running as the installation
  user, pinned to the enrolled release's Node/CLI outside the app control group;
* `/etc/systemd/system/roost-UID.service.d/updater.conf`, ordering startup after
  the helper and supplying its fixed startup capability file;
* `/etc/sudoers.d/roost-UID-updater`, allowing **only** noninteractive
  `/usr/bin/systemctl start roost-UID.service` and
  `/usr/bin/systemctl stop roost-UID.service`.

HTTP has no enrollment, repair, shell, path, URL or unit-control operation.
The daemon verifies that it is the fixed helper unit's main PID; it cannot be run
as an unsupervised CLI subprocess. The helper accepts bounded protocol messages on `ROOST_HOME/updates/helper.sock`,
mode 0600, through a separately supervised Python peer-credential bridge. Only
its own UID is accepted. The socket and operation directories are private.

Enrollment leaves `ROOST_HOME/operation.lock` as a permanent legacy CLI fence.
**Do not delete it as a stale PID file.** Current CLI setup/update/start/stop and
the helper share a kernel `flock` domain, `updater.lock`; enrolled updates and
start/stop route through the helper. Enrolled `roost update` prints the offer;
`roost update --version EXACT_VERSION` explicitly confirms it. Never unlink that kernel lock file either.
`updater-owner.json` records PID, boot ID and process-start ticks for diagnostics;
it may be stale after exit and never grants ownership. A separate lifetime
`updater-supervisor.lock` prevents a second helper invocation from replacing the
active socket or changing its gate; it never replaces the shared transaction lock. `flock` (util-linux),
Python 3, findmnt and systemd/sudo are required on the initial platform.

Repeating enrollment with the same pinned helper is supported after partial
setup. Re-enrolling from a different release refuses to replace a running helper.
Helper upgrades are separate operator maintenance: finish/recover all operations,
stop the app and helper, review the new helper's protocol compatibility, then
replace the pinned helper unit and enrollment metadata under the installation
lock. There is intentionally no automatic helper upgrade or uninstall command.
Do not remove the legacy fence while any older CLI can access this installation.

For a private repository, provision a read-only release credential explicitly as
`ROOST_HOME/updates/github-token`, a regular installation-user-owned file, mode
0600, at most 1024 bytes. Restart only the helper during authorized idle
maintenance to load a changed credential. It is never returned to the browser or
inherited from the web process. API requests cannot redirect that credential;
artifact redirects permit only GitHub's fixed release asset hosts without the
authorization header.

## Transaction and recovery

Settings checks the configured repository's published stable release. The offer
pins repository, release ID, asset ID, version, SHA-256 digest, size and expiry.
“Published” is not a promise of compatibility: downloaded manifests, schemas and
bundled runtime execution are checked before stopping. A same-publisher API digest
detects replacement/corruption, not publisher compromise. Missing digests, changed
identities, downgrade/equal versions, drafts/prereleases and expired offers fail.
Downloads, metadata, request bodies, redirects and extraction are bounded.
Extraction accepts regular files/directories only, rejects links, devices, path
escapes, duplicates and unsupported extensions, and caps expanded bytes and files.

Activation requires exact version confirmation and a native passkey session less
than five minutes old, exact Origin/host, JSON, a session-bound CSRF token and a
bounded idempotency key. Session validity is rechecked after reading the body.
Acceptance is journaled/fsynced before acknowledgement. Repeating the accepted
key returns its operation; changing its actor/offer/version conflicts. Once
accepted, session expiry does not cancel recovery. No lost response triggers an
automatic POST retry.

The helper holds the installation lock across staging, drain, stop, snapshot,
activation, probe and commit. It blocks new conversation/steering/automation/
delegation/coding claims transactionally while continuing existing coding-worker
observation. Running, missing, unknown, stale or identity-uncertain workers defer
the update. Review status alone is insufficient: idle identity must be verified
and fresh. Queued jobs remain queued. In-flight requests, login, desktop viewers/
actions and background tasks must finish before stopping. The five-minute drain
deadline never authorizes forced termination or replay. Cancellation is durable
before the stop boundary; a later cancel request is refused.

After closing all writers, the helper stops the exact service and verifies its
control group empty. The complete `data` tree (both SQLite stores, sidecars,
managed files/memory/workspaces) is copied, integrity/digest checked and fsynced.
Config is retained alongside the snapshot for diagnosis/operator recovery.
Symlinks, hard links, special files and nested mounts are rejected rather than
silently excluded. Capacity checks reserve staged bytes, snapshot/restore space
and inode headroom. Snapshot permissions are reduced to owner-only access.
Snapshots are secrets; they can contain credentials and conversation content.

The candidate starts behind a capability-bound gate that blocks ordinary HTTP,
auth writes, worker claims, login and external effects. A two-minute probe checks
expected version/operation, app and auth database integrity/schema, packaged
assets and worker initialization. A durable commit precedes opening admission.
A previously stopped CLI installation is probed but returned to stopped state.

Before commit, failure restores a verified copy of the snapshot and selects the
matching previous release. Candidate data is retained separately as `failed-data`;
the original snapshot remains untouched. Recovery resumes interrupted pointer/
data renames and re-probes the previous version behind the gate. After commit,
automatic recovery never restores old data or discards new work. Missing/corrupt
evidence, an unexpected pointer or failed recovery keeps maintenance closed.
Boot recovery runs in the pinned helper; the app also rejects startup without
current-boot readiness and a valid open/verification gate.

## Status, reconnect and repair

The searchable Settings section shows actual phases, blockers and downloaded
bytes, never invented percentages. It supports cancellation, deferral, recent
authentication, cached outage messaging, multi-tab observation and manual asset
reload while preserving the route. Polling backs off after disconnection. An
unconfirmed response stays pending until its request key matches durable status
or the operator explicitly dismisses it after inspection. A closed app cannot
serve fresh progress; the browser says it is reconnecting.

Unsubmitted composer text and uploaded attachment references are retained in
bounded browser-local storage, separately per tab and conversation. Sending
clears that tab's draft; reload never submits it. Storage failure is surfaced.
Do not rely on browser drafts as a backup, and use a trusted browser profile.
Mutating submit controls pause during drain while read/navigation and deliberate
stop controls remain available; server barriers enforce the admission decision.

The independent terminal diagnostic command works even when the app/socket is down:

```sh
roost updates status
roost updates status --id OPERATION_UUID
journalctl -u roost-UID-updater.service
journalctl -u roost-UID.service
```

It reports the fixed units, installation, gate, advisory lock owner, phases and
matching snapshot locations under `ROOST_HOME/updates/OPERATION_UUID/`.
Do not publish those directories or raw data/config files. Retain journals,
`snapshot.json`, `snapshot/`, saved config, `failed-data/` and both releases while
investigating. Never guess a snapshot or delete a lock to resume service.

For an intact manual-recovery operation, after fixing the underlying problem,
the terminal-only repair retries the recorded decision with explicit version:

```sh
# Only for an uncommitted operation, using its recorded previous version:
roost updates repair --id OPERATION_UUID --decision restore --confirm-version 0.1.40
# Only for a committed operation, using its recorded candidate version:
roost updates repair --id OPERATION_UUID --decision resume --confirm-version 0.1.41
```

The helper rejects the wrong decision/version. Repair cannot bypass failed
snapshot integrity or resurrect corrupt/missing journals; those require manual
forensic recovery from independently verified backups with the app stopped.
After commit, no automatic “restore previous data” option is offered.

Retention is conservative: **no automatic deletion** of operations, snapshots,
failed data, or retained releases. Operators may archive old terminal operations
only during idle maintenance after keeping the last verified recovery pair and
the helper's pinned release. Never reclaim the only recovery pair to make an
update fit. Large installations may need operator-managed backup/update instead.

## Verification and qualification

See [verification evidence](ui-self-update-evidence/README.md) for matched rendered
screenshots, exact test results, disposable VM setup and remaining acceptance
gaps. Unqualified activation remains disabled despite the implemented engine and
UI. This is a safety gate pending evidence, not an HTTP-accessible override.
