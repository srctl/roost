# UI self-updates: implementation status

**Draft, incomplete. UI activation is disabled for every installation.** This
branch is not an implementation of all three approved phases and must not be
released as a working self-updater. No enrollment command or updater service is
installed by this code. Do not delete legacy lock files to enable the UI.

The approved design is available at
[the immutable design revision](https://github.com/srctl/roost/blob/47093a36a0858e9948e68cba7c403e56ee61425e/docs/ui-self-update-design.md)
and [design PR #10](https://github.com/srctl/roost/pull/10). This branch starts at
`7415789` (0.1.40); it does not assume the design PR has merged.

## Implemented behavior

Settings has a searchable Updates section. Source/orchestrated installations
report externally managed status. Packaged installations report unsupported
architecture/service-manager reasons or that enrollment and activation remain
unimplemented. Nothing infers privileges from Linux x64, a proxy login, or the
presence of `ROOST_HOME` alone.

A native-authenticated packaged installation with a configured repository can
request bounded, rate-limited stable-release metadata. The check pins repository,
release/asset IDs, SHA-256 digest, advertised size, version and expiry. It rejects
ambiguous artifacts, drafts and prereleases. Conditional requests retain the
original offer expiry; a 304 does not authorize an expired offer. Remote notes
are rendered as plain React text. Network failures are not “up to date.” Metadata
alone is not evidence of artifact or migration compatibility.

`GET /api/updates` exposes only local capability when native authentication is
absent; remote metadata and CSRF tokens require a native session. The check POST
requires a recent session, exact origin/host, JSON, a session-bound CSRF token and
an empty allowlisted body. Activation POSTs cannot invoke the legacy CLI or any
other executable. No browser request can install privileges.

The default web process does not inherit a terminal's GitHub credentials into
this release checker. The checker primitive supports an explicitly supplied
read-only credential, with redirects disabled. Private-repository credential
provisioning for a future supervised helper remains outstanding.

Current CLI setup/update/start/stop operations now acquire an inherited-file-
descriptor `flock` lock as well as the legacy exclusive-create lock. The kernel
lock file is never unlinked. The legacy lock remains necessary to exclude old
binaries; a hard interruption can still leave that legacy file. This is not the
permanent enrollment sentinel or automatic stale-lock recovery described in the
design. `flock` from util-linux is required for this Linux CLI path.

The 0.1.40 coding worker already observes existing workers during maintenance and
fences ambiguous Herdr recovery/submission. Those protections remain intact.
CLI draining now includes steering, missing workers and null observations. A
maintenance predicate also prevents claiming new steering. Conservatively, review
jobs remain blockers even if their last observation was idle. Nothing replays a
prompt or forcibly stops a worker.

## Recovery primitives, not an activated recovery engine

The new internal modules provide a versioned compatibility contract, durable
private JSON replacement with file/directory fsync, journal identity/sequence
validation and conservative recovery decisions. A committed record cannot be
rewritten as a restoring record. Unknown/corrupt evidence is rejected.

The snapshot primitive copies complete managed app data into a private operation
directory, requires both SQLite stores, verifies database integrity and content
digests, checks space/inode headroom, and rejects links, hard links, special files
and nested mounts. It compares source content before/after copying and never
accepts an existing partial snapshot. It assumes an external supervisor has
already stopped and fenced writers; it does **not** establish that condition.
Configuration/release identity capture must still be integrated with the engine.

These modules are exercised with disposable files and child processes. They are
not called by HTTP activation or the existing CLI update transaction. There is
no automatic retention deletion; test snapshots are removed only with their
disposable fixture. Future enrollment must protect and retain at least the last
complete recovery pair, never reclaim it just to make room for an update.

The compatibility contract defaults to refusing absent/unknown app/auth ranges,
helper protocol, data format or bundled Codex version. It requires unchanged
excluded mutable state. It is not yet emitted by packaging or enforced by an
activation engine; existing release bundles therefore have no qualified UI
migration contract. Managed-data snapshots cannot restore `~/.codex`, browser
profiles, external worktrees, remote Herdr infrastructure or external actions.

## Remaining implementation and acceptance gates

1. Enrolled installation validation (including distribution, mount durability,
   canonical identities and service authority); pinned separately supervised
   helper; private socket peer credentials; root-owned fixed-unit noninteractive
   service policy; permanent legacy CLI sentinel; shared CLI/helper routing.
2. Bounded artifact streaming/extraction and runtime execution preflight tied to
   immutable accepted offers; packaging compatibility contract; durable actor,
   idempotency and offer acceptance records.
3. Full transaction executor, cancellation/deferral, writer/quiescence barrier,
   complete snapshot/config pair, systemd stop/group verification, candidate
   startup capability and side-effect gate, bounded multi-surface probes, durable
   commit, data/release rollback and resumable rename intents.
4. Boot ordering and manual-launch guard, independent read-only diagnostics and
   a tested operator repair procedure. Never run an old release against migrated
   candidate data or automatically restore data after committed work.
5. UI version confirmation, durable operation observation, lost-response
   reconciliation, multi-tab maintenance, retained drafts, reconnect/reauth and
   one-time asset reload. No activation controls are exposed before these gates.
6. Real disposable Ubuntu 24.04 systemd and reboot/fault-injection qualification,
   followed by authenticated browser update/rollback acceptance. Additional
   distributions and changed bundled runtimes require separate evidence.

There is intentionally no operator enrollment recipe yet: installing an
unqualified helper would bypass these gates. Continue the documented
[operator-managed installation/update workflow](install.md) with its existing
limitations. Do not claim zero downtime, universal recovery, or rollback of
external effects.

## Verification matrix and infrastructure limits

| Design layer | Available evidence | Still required |
| --- | --- | --- |
| Release | Numeric stable versions; offer identity/digest/size/expiry validation; duplicate/draft/prerelease rejection; HTTP failure/backoff/coalescing; byte bounds; redirect refusal; unknown compatibility refusal | Live offline/private/429 behavior; approved artifact replaced at download; bounded hostile archive extraction; ABI execution; packaged migration compatibility |
| Authorization | Recent-session/origin/host/JSON/CSRF and field-allowlist tests; unauthenticated source activation/check rejection; no-store status | Native end-to-end activation; revocation races; accepted-operation authorization consumption; idempotency conflicts |
| Concurrency | Real kernel flock exclusion against another client and CLI; SIGKILL releases kernel ownership; lock symlinks rejected; legacy exclusion retained | Helper versus CLI/enrollment races; permanent old-CLI fence; reboot identity; durable acceptance under lost replies |
| Work | Existing 0.1.40 coding observation/recovery regressions; steering barrier; active/missing/null observations block CLI draining | Global submission/tool/delegation quiescence at stop boundary; external idle attestation; authenticated update initiated by active coding work |
| Data | Both SQLite databases and managed files copied/verified; tampering rejected; links refused; capacity refusal; journal corruption/identity/sequence checks | Large datasets; WAL/SHM crash boundaries; all mount/layout cases; disk/inode exhaustion during writes; copy interruption; config pairing; rollback restore transaction |
| Lifecycle | Existing fake-service CLI rollback regressions | Real systemd update, rollback, group-empty proof, slow shutdown/orphans, port collision, candidate assets/auth, helper survival, initially stopped installation |
| Fault injection | Child lock-owner SIGKILL; recovery decision rules; commit-to-restore refusal | Process kill and actual VM reboot at every journal/snapshot/rename/start/commit/admission boundary; failed rollback/manual recovery |
| Browser | Actual matched desktop/mobile Settings screenshots; source capability and disabled controls | Accepted update/rollback, lost response/disconnect, retained drafts, multi-tab synchronization, reauth, stale assets, assistive-technology validation |

Read-only infrastructure research found Docker 29.1.3 reachable outside the
sandbox, with no existing test images; Docker alone is not evidence of a
rebootable Ubuntu systemd VM. No local QEMU or systemd-nspawn runner was found.
The documented exe.dev SSH host fingerprint was verified against its official
reference using a temporary known-hosts file. The API then rejected the available
credentials (`Permission denied (publickey,keyboard-interactive)`). No host SSH
configuration was changed and no VM was provisioned. An authorized disposable
Ubuntu 24.04 VM/runner and access method are needed to close the real lifecycle
and reboot test gap. No live Roost service/configuration/storage was modified,
enrolled, restarted, or updated.

## Checks completed for this draft

All repository check components passed: lint, TypeScript, 173 unit tests, app and
CLI builds, production-auth smoke, site TypeScript, six site tests and both site
builds. The final updater-focused rerun passed all 12 tests. Chromium verified
Settings in two tabs at both desktop/mobile viewports, search and Escape-to-clear,
no horizontal overflow, disabled source checks and denied source activation.

The first check attempts inherited Roost/Codex/Herdr/listener environment values
and a `0077` umask. These conflicted with unrelated test assumptions. Checks were
run with those runtime/listener variables removed and a `0022` umask scoped to
the test subprocess; production-auth/site checks were completed separately after
the listener override was removed. The new snapshot/journal tests also passed
under the original restrictive umask. This does not qualify systemd updates,
boot recovery or the unimplemented activation flow.

Docker-based VM emulation was not attempted. The available Docker daemon may be
a route to future disposable qualification; its availability has not established
that the full VM/reboot matrix can run here. Infrastructure limitations are
separate from the unfinished implementation listed above.
