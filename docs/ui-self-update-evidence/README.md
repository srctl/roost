# UI self-update acceptance evidence

PR #11 implements phases 1–3 of the approved design, starting from `7415789`
(0.1.40), including that baseline's coding protection/recovery changes. Design
PR #10 is separate; this implementation does not assume it merged.

The supported enrolled path is enabled. The temporary blanket qualification gate
has been removed after real systemd/reboot acceptance. The final native-browser
update and rollback below used the normal production build, with no qualification
transform or override. Capability, enrollment, compatibility, work and native-auth
checks remain mandatory.

All service, enrollment, update, rollback and reboot experiments ran in a private
disposable VM. No live Roost service, configuration, credentials or data was
enrolled, restarted or updated. No release was published. Private fixture keys,
guest disk images and raw logs are excluded from the PR.

## Matched rendered screenshots

Actual Chromium screenshots, isolated empty data, light theme, device scale 1.
Baseline `7415789` and this branch both show `/settings`, search `software update`,
at identical viewports. Full-page image height follows the content. Baseline has
no matching setting; the source build now gives its external-management reason.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop 1440 × 1000 | [Before](before-desktop.png) | [After](after-desktop.png) |
| Mobile 390 × 844 | [Before](before-mobile.png) | [After](after-mobile.png) |

Matched expired-session state, same Updates card scrolled to its actions, using
controlled API responses at the same desktop/mobile viewports. The change adds
an actionable native sign-in link and disables mutations until reauthentication.

| Viewport | Before reauth fix | After reauth fix |
| --- | --- | --- |
| Desktop 1440 × 1000 | [Before](reauth-before-desktop.png) | [After](reauth-after-desktop.png) |
| Mobile 390 × 844 | [Before](reauth-before-mobile.png) | [After](reauth-after-mobile.png) |

Actual native-auth/real-helper lifecycle with private release fixtures:

| State | Desktop 1440 × 1000 | Mobile 390 × 844 |
| --- | --- | --- |
| Exact version confirmation | [Desktop](native-confirm-desktop.png) | [Mobile](native-confirm-mobile.png) |
| Successful update | [Desktop](native-success-desktop.png) | [Mobile](native-success-mobile.png) |
| Failed startup, matching pair restored | [Desktop](native-rollback-desktop.png) | [Mobile](native-rollback-mobile.png) |

Earlier `confirmation-fixture-*.png` images use deterministic API responses and
are labeled API-fixture views. They are not end-to-end lifecycle evidence. No
image is a mockup.

## Actual authenticated lifecycle

| Candidate | Result | Actual operation | Initiating viewport |
| --- | --- | --- | --- |
| 0.1.202 | succeeded | `7488215c-f28a-44a6-bf12-c157ebc7e462` | Mobile |
| 0.1.203 | rolled-back | `bd9ca65b-2754-448d-bf65-6db1bf745a12` | Desktop |

Both runs preserved the original data sentinel, used exactly one activation POST,
reconnected across the real service outage, retained drafts across reload/closed
tabs, and returned to Updates after a second native passkey login. Rollback
retained the candidate-written sentinel separately in `failed-data` and restored
the original data with release 0.1.202. Both services finished active with admission open.

Normal helper SHA-256: `f5972432b9a0ab1e3da14dbe5860b1edbef9d38232754cf7505d8f8df8f7ffe8`.
Recovered production app entry SHA-256 (matches local normal build): `831b567646703829727d29a504479acc31ab8ef382a5b2346934aef8564d05d1`.
Test TLS certificate SHA-256: `999304dc18fce0a235a1ed8b0d8984e519114cdfe563f9489c31bfa7524513e2`.

| Private artifact | Bytes | SHA-256 |
| --- | --- | --- |
| 0.1.202 | 145074737 | `cca2f9dd83d160cfdce63acdfdedd6a8e80d55e37bd73be290dfe403f2d8a7a7` |
| 0.1.203 | 145001639 | `4f482bcebd6ed87db7cdf57d1c307d90cd5a58a95651796380dfeb396b897e81` |

These are local fixture versions, not published Roost releases. Both bundle
Node 24.15.0 and Codex 0.153.4; the bad candidate deliberately throws after
writing its sentinel. The healthy candidate uses the checked production app.

`scripts/test-updates-native-browser.mjs` uses Chromium's native WebAuthn virtual
authenticator to sign real login challenges with a credential registered through
native setup. It sends actual
Origin/CSRF-protected requests to the production API and enrolled helper. Its
only update-response interception delivers the real acceptance POST, verifies HTTP 202,
then drops that response. It does not mock authentication, update status, artifact
validation or service control. The test checks durable request reconciliation,
multiple tabs, desktop/mobile drafts, explicit reauthentication, historical key
lookup after a new session, keyboard focus/Escape/Enter, the accessibility tree,
and absence of any replayed prompt or update POST.

Private local fixtures use built compatible packages with test version manifests
and real SHA-256/size metadata. A private HTTPS server inside the disposable
container answers the fixed GitHub API and release-asset hostnames. Only the
guest maps those hostnames to the fixture server and trusts its generated test
CA through a root-owned helper override. TLS verification, production hostname,
redirect, artifact digest/identity and compatibility checks remain enabled.
Nothing was uploaded to GitHub releases or an external fixture service.

The initial native path passed 0.1.49 success and 0.1.50 startup rollback using a
test-only qualified helper build. The final results above repeat the supported
path with the normal production build, after removing the temporary qualification
gate; no build transform or runtime override is used for that final run.

## Real service authority and lifecycle faults

The app runs as guest UID 1000 (`ubuntu`) without general sudo or sudo-group
membership. Its only noninteractive authority is the generated exact app-unit
start/stop rule. The authenticated test administrator is a separate guest user.
Policy checks deny root shell/id, app restart and unrelated-unit start. A separate
real SO_PEERCRED check rejected guest root and accepted the app UID against the
same stable helper process, distinguishing peer authorization from file access. A root-only
canary plus an app-user symlink at the obsolete `start.env` path verified that
privileged systemd no longer reads an app-writable environment file.

* The earlier real initially-stopped 0.1.44→0.1.46 fixture update succeeded,
  kept the app stopped, retained its data and left the helper active. CLI
  start/stop used the private helper route. A standalone/duplicate helper was
  rejected without replacing its socket or gate. These retained checks precede
  the final normal-build native acceptance and are not counted as new runs.
* A slow SIGTERM handler and a separately detached orphan in the app control
  group were stopped cleanly; elapsed time was 6.28 seconds, the group was empty,
  and the independently supervised helper survived.
* A candidate with a missing referenced CSS asset (and an unrelated decoy asset)
  rolled back. A separately malformed auth database also rolled back. Both
  restored the previous release and matching data before reopening admission.
* A separate guest listener occupying the app port caused both candidate and
  rollback probes to fail. The updater retained manual recovery and did not kill
  the unrelated listener. After the test operator removed that fixture listener,
  explicit CLI repair restored the verified previous pair.
* A truncated journal remained intact while the helper held manual recovery.
  Restoring its known original bytes was an explicit test-operator action.
* A corrupt snapshot was refused, preserving candidate data and owner-only
  diagnostics. Restoring the known snapshot bytes and requesting explicit CLI
  repair recovered the old pair and retained failed candidate data.
* During the real native-browser drain, both the exact baseline `7415789` CLI
  and the current CLI refused setup, update, start and stop races. Current CLI
  auth recovery also refused. No additional operation, app restart or auth
  configuration change occurred.

A separate normal-production helper test committed the candidate, wrote new data,
then made its startup fail. Recovery kept the committed release/data and closed
admission for manual recovery; it did not restore an old snapshot. After the
operator restored the known entry bytes, explicit `repair --decision resume`
completed, retained the new data and cleared the stale public failure message.
Operation: `bdb3296b-c1f1-4381-b158-9237b546b571`.

## Journal, activation and boot boundaries

**42 distinct boundaries × two real interruption mechanisms = 84 completed cases:**
42 actual helper SIGKILLs and 42 actual guest reboots. See the
[audited boundary table](boundaries.md) for every trigger, operation and result.
This includes journal transitions before/after commit, pointer replacement,
shutdown/startup, snapshot completion, both data renames and rollback activation,
including rename-before-directory-fsync windows.

The boundary driver uses the real systemd adapter, snapshots, kernel locks and
recovery engine; only staging is replaced with preinstalled private fixtures.
Independent native lifecycle tests above exercise the actual download/staging
path. Rollback-boundary tests inject candidate readiness rejection to reach the
required boundary without redundantly repeating the real two-minute health
failure tests. Markers include run/operation UUID, phase, process PID, guest boot
ID and timestamp. SIGKILL cases require systemd's recorded signal 9. Reboot cases
require a QMP RESET event and a changed guest boot ID. Both require a terminal
journal and the expected release/data/admission/service state before counting.

Not every trigger is a different recovery algorithm: several pre-stop journal
boundaries share old-release preservation, and several pre-commit boundaries
share matching-pair restore. Repeated setup/debug attempts are excluded from
unique-case totals. One unsynced private preinstalled fixture lost its candidate
contract on reset. That attempt was excluded, exposed a real recovery-startup
validation defect, and was recovered with the fix while retaining its evidence.
Subsequent fixture setup explicitly fsyncs before the audited reset.

## Automated and storage checks

`pnpm check` passed: **202 tests**, native-auth smoke test, six site tests,
Biome lint/format, TypeScript, and application/CLI/marketing/docs production builds.
Rendered browser checks passed at desktop and mobile sizes. The native-browser
runs above are additional actual-guest acceptance, not mocked API checks.

The final native run initially exposed transient SQLite schema-read contention
while the old app was still serving. That pre-stop operation failed safely,
leaving its release/data available. Schema reads now use a bounded five-second
busy timeout. A real cross-process regression failed before the fix and passes
for transient locks on both databases and persistent-lock refusal. The final
normal-helper lifecycle was rerun with rebuilt, newly pinned artifacts after
that fix; the failed preparation attempt is excluded from successful totals. A separate
harness retry initially matched an older operation for the same version before
its new acceptance returned. Matching now requires the accepted operation UUID.
That accepted update completed successfully after the browser closed, but its
incomplete browser run is excluded; fresh fixture versions exercise the entire
corrected browser flow above.

The real post-commit repair case exposed an 18-second socket cutoff even though
repair eventually succeeded. Fixed, action-specific bounded transport budgets
now cover service control and repair, while status stays responsive. A real
socket regression delays repair for 21 seconds and requires concurrent status
within five seconds. Successful repair also clears its stale public error while
retaining private diagnostics; that regression failed before the fix and passed
after it.

A separate real ext4 guest filesystem verified a killed SQLite writer's committed
WAL and a 16 MiB workspace snapshot. Actual block/inode headroom exhaustion
refused snapshot creation with no partial snapshot. A separate temporary-root
stress run copied and verified 536,923,050 bytes across 2,053 entries, including a
512 MiB workspace file. Deterministic I/O fault injection at the filesystem
boundary covers snapshot/restore copy and fsync failures and a post-rename
acceptance fsync failure; assertions confirm the injection was reached and check
pairing, admission, retained data and manual-recovery evidence.

Release tests cover offline/429/private-token failure, changed offers/assets,
missing/mismatched digests, identity/tag/platform/protocol/schema/Codex mismatch,
exact runtime output, bad ABI, archive limits/traversal/links/devices, credential
stripping on redirects, and compatibility of both the candidate and rollback
release with the actual database snapshot. Existing schema-upgrade tests cover
legacy v8/v9 shapes, preservation and repeatability; newer schemas are refused.

Authorization tests cover no native auth, recent/expired/revoked sessions,
Origin/host/CSRF, bounded fields/queries/bodies, GET mutation rejection and
revocation during streamed request reading. Kernel-lock/socket tests cover
concurrent owners, SIGKILL release, fixed peer UID and legacy CLI fencing.

The actual native-browser cancellation and five-minute deferral tests used an
inert, identity-uncertain coding-worker record. The real observer's timestamps
continued advancing while admission was closed. Both preserved the app PID and
created no prompt inputs or reports. The test-only record was then removed.

Work tests keep existing observations running while claims/submissions stop.
They cover active/missing/unknown/stale/changed identities, cancellation and
follow-up recovery, admission closing during launch/follow-up preparation,
post-shutdown uncertainty, chat/steering, queued automations, expiry and exactly
one catch-up after downtime. No model API or paid worker is used by these tests.

## Disposable runner and limits

QEMU 8.2.2 with TCG boots Ubuntu 24.04.4 amd64, systemd 255, local ext4, 1 GiB
RAM and two virtual CPUs. The Docker container drops all capabilities, uses
`no-new-privileges`, and has no host mounts/devices or exposed host ports. Its
memory limit is 4 GiB. The private guest disk was grown from 8 to 16, then 20 GiB for
retained fixtures; only the disposable guest filesystem was resized, using
[QEMU’s documented block_resize command](https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html).
Superseded fixture archives were removed; metadata, journals, snapshots and guest releases
were retained.
The official Noble image's SHA-256 was checked:
`d0fe84bb5f80853425fa6be28e2c106f30104c3cfe8611933f2e65c9b63f0e30`.
Generated test keys and strict pinned SSH host-key checking were used throughout.
Guest-only optional cloud/package services were disabled to reduce emulation
boot noise; Roost, SSH, network and storage services remained real.

Automated accessibility evidence is Chromium keyboard/focus behavior, its
accessibility tree and mobile viewport rendering. Physical screen-reader use,
VoiceOver/Safari and additional mobile browsers require those devices and a
manual assistive-technology pass; they are not claimed here. Remote working/idle
worker and submission races use isolated transport/runtime fixtures. The native
browser test uses actual missing-worker observation and deferral, without paid
model calls or live remote jobs. A live Herdr integration run would require a
disposable endpoint, credentials and authorized model quota.

QMP resets exercise an actual guest reboot and filesystem recovery, not a physical
drive's power-loss characteristics. Copy/fsync failures are deterministic injected
I/O errors; block/inode exhaustion is real. No claim is made for arbitrary hardware
failure or untested distributions/filesystems. No additional infrastructure or
release publication is needed to reproduce the completed narrow-path tests.

These results qualify the documented narrow installation contract, not arbitrary
Linux distributions, custom units, filesystems, publisher compromise, external
writers/effects, physical-device power-loss behavior or later application bugs.
Updates cause downtime. Automatic recovery never promises to undo post-commit
work. Snapshot and journal corruption remain explicit operator recovery cases.
