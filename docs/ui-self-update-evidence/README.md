# UI self-update evidence

These results distinguish implemented behavior from release qualification.
**The production helper's activation gate remains false; PR #11 remains a draft.**
No live Roost service, configuration or data was enrolled, stopped, updated or
restored. Test guest files, keys, disk images and raw logs remain outside the PR.

## Matched rendered screenshots

Actual Chromium screenshots of the source app with isolated empty data, light
theme, device scale factor 1. Baseline: `7415789` (0.1.40). After: this branch.
Both use `/settings`, search `software update`, and the same viewports. Full-page
capture height may vary with content. Before has no matching setting; after
shows the source-build external-management reason and disabled update check.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop 1440 × 1000 | [Before desktop](before-desktop.png) | [After desktop](after-desktop.png) |
| Mobile 390 × 844 | [Before mobile](before-mobile.png) | [After mobile](after-mobile.png) |

Supplemental **rendered API-fixture views**, not matched lifecycle evidence:
[desktop confirmation](confirmation-fixture-desktop.png) and
[mobile confirmation](confirmation-fixture-mobile.png). These exercise the real
component with a deterministic qualified-offer response; they do not imply that
this unqualified helper permits activation. No image is a mockup.

## Automated checks

`pnpm check` passed: lint, TypeScript, 191 unit tests, app/CLI builds,
production-auth smoke (enrollment, login, private pages/API, desktop upgrades,
revocation, recovery), six site tests, site TypeScript and both site builds.
Runtime/listener environment variables inherited from Roost were removed for
these tests; umask 0022 was scoped to the check subprocess for existing packaging
expectations. Tests use disposable roots and independent subprocesses.

Updater tests cover successful and initially-stopped transactions, coherent
rollback, retained failed data, post-commit repair preserving new work, duplicate/
conflicting requests, concurrent engines/kernel locks and SIGKILL lock release,
durable repeated cancellation, failed preparation/uncertain-work deferral,
corrupt evidence, and startup/HTTP gates. Simulated interruption coverage includes
20 journal/lifecycle boundaries plus both rollback data-renames, with assertions
on release/data pairing and admission. The probes assert database admission is
closed, including recovery after commit. Snapshot tests include both databases,
files, integrity, permissions, tampering, links and headroom refusal.

Release tests cover numeric versions, pinned offer identity/digest/size/expiry,
HTTP failure/backoff/coalescing, streamed limits, changed artifacts, hostile
redirects and credential stripping, bounded safe extraction, runtime/manifest
validation, repeated identical staging and compatibility refusal. Security tests
cover recent native sessions, exact origin/host, JSON/CSRF, field allowlists,
unauthenticated rejection and session revocation while reading a streamed body.
Coding tests retain 0.1.40's recovery/observation coverage and explicitly reject
working, missing, unknown, stale, cancelled or identity-uncertain workers.

`scripts/test-updates-browser.mjs`
passes at 1440×1000 and 390×844 using real Chromium rendering and deterministic
update API responses: exact version confirmation, lost acceptance response,
reload, two tabs, cancellation, network outage, reauth notice and no horizontal
overflow. Draft tests verify per-conversation/tab retention and sent-draft
clearing without replay. Additional actual composer checks with two disposable
agents passed reload and conversation isolation at both viewport sizes, with no
prompt-bearing POST requests. To reproduce against a disposable preview:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROME_BINARY=/path/to/chromium \
UPDATE_TEST_URL=http://127.0.0.1:4191 \
node scripts/test-updates-browser.mjs
```

## Real systemd and reboot evidence

The available Docker daemon can run a disposable **userspace QEMU VM**; no paid
VM or additional exe.dev SSH access was required. The test container drops all
Linux capabilities, uses `no-new-privileges`, no host mounts/devices and TCG
emulation (no KVM). QEMU 8.2.2 boots an Ubuntu 24.04.4 amd64 cloud image with
systemd 255 and a sparse 8 GiB ext4 guest disk, 1 GiB guest RAM, two virtual CPUs.
The container memory limit is 4 GiB: the initial 2 GiB container limit caused an
OOM during fixture transfer/setup and was increased only for that container.

The official image was downloaded from
[Ubuntu's Noble cloud-image directory](https://cloud-images.ubuntu.com/noble/current/)
and checked against its SHA256SUMS:
`d0fe84bb5f80853425fa6be28e2c106f30104c3cfe8611933f2e65c9b63f0e30`.
Cloud-init installed generated **test** authorized keys and a pinned test host
key. SSH used strict host-key checking. No host credentials or SSH authentication
were bypassed, and no host service/configuration was changed.

Inside that guest only, the packaged CLI installed `roost-1000.service`, native
auth storage and explicit enrollment. The helper runs in its own systemd control
group, pinned to the retained 0.1.40 **test build**. Lifecycle candidates are copies
of built packages with test version manifests; they are not published releases.
`scripts/test-updates-systemd.ts`
requires a disposable guest marker and fixed guest identity/root. Its real adapter
controls systemd, drains, snapshots, probes and recovers. Only artifact staging is
replaced by preinstalled fixtures; network pinning/extraction is tested separately.
Standalone daemon invocations are rejected unless their PID is the fixed systemd
helper unit's main PID; a separate lifetime lock also protects its socket/gate.
The product helper stays unqualified; the test driver invokes the engine directly.

Recorded results:

* Real 0.1.40→0.1.41 fixture update succeeded; app and helper remained active.
* A deliberately broken 0.1.42 candidate changed a data sentinel then failed
  startup. Within the bounded probe/recovery sequence, the engine restored
  0.1.41 and the original sentinel, retained the candidate sentinel in failed
  data, and returned both services to active state.
* A real QMP system reset at the 0.1.43 verification boundary changed the guest
  boot ID. The boot helper restored 0.1.41, verified it and opened admission.
* The final shell-probe fixture 0.1.44 reached durable commit/admission-open,
  then a new data sentinel was fsynced before a second real VM reset.
  Recovery preserved 0.1.44 and that sentinel and returned both services to active state.

* Real engine/helper SIGKILL recovery is confirmed at 17 boundaries: accepted,
  staged, draining, stopping, service-stopped, snapshot-complete, activating,
  pointer-renamed, verifying, service-started, and before journal writes for
  staged, draining, stopping, snapshot-complete, activating, verifying and
  committed. Systemd recorded signal 9 for each injected driver death; code/data
  and admission were checked after helper recovery. One initial service-stopped
  attempt exited during preparation and was excluded, then rerun with an explicit
  boundary-file assertion and confirmed SIGKILL.
* The final supervised-only build rejected a standalone/duplicate helper without
  changing the active gate or socket. A real initially-stopped 0.1.44→0.1.46
  update succeeded, kept the app stopped, retained new data and left the helper
  active. CLI start/stop used the private helper route.

The test-only lifecycle driver can be bundled with Vite SSR, copied to the guest,
and run as the installation user in a separate systemd unit. It accepts a target
fixture version, a boundary and `run`, `kill` or `reboot`; in reboot mode the outer
harness resets QEMU through its private QMP socket. The marker is
`/etc/roost-update-disposable`; root is `/home/ubuntu/roost-update-test`, UID 1000,
user `ubuntu`. These are test harness requirements, not production configuration.

## Complete design matrix: remaining qualification gaps

| Layer | Implemented/tested here | Evidence still required before activation qualification |
| --- | --- | --- |
| Release | Pinned metadata/download/extraction/compatibility integration and hostile/offline fixtures | Authenticated full browser→helper transaction using a gate-aware compatible release artifact from an authorized test release source; broader ABI/legacy-schema fixture coverage |
| Authorization | Native session/origin/CSRF/body bounds and revocation race; existing production passkey smoke | Full native-passkey browser update/rollback through the real helper; credential/authorization behavior across all restart races |
| Concurrency | Shared real kernel locking, durable idempotency, simultaneous engines, private socket, fixed-unit policy and legacy fence | Full enrollment/setup/start/stop/UI race stress; separate-UID broker integration on hardened policy without the disposable cloud user's broader test sudo privileges |
| Work | Admission/observation split, steering and coding recovery regressions, fresh idle identity, global task/request/login/desktop quiescence | Real remote coding/chat/tool/delegation activity and cancellation at every stop race; real automation schedule expiry/catch-up during downtime |
| Data | Complete protected snapshot and matching-pair restore, failed-data retention, SQLite integrity, link/mount refusal and capacity checks | Large data, retained WAL crash fixtures, true block/inode exhaustion and copy/fsync failure injection throughout snapshot/restore; additional migration fixtures |
| Lifecycle | Real systemd success, failed-startup rollback, separate helper survival, gated shell/assets/auth/schema probes, initially-stopped CLI update and standalone-helper rejection | Slow shutdown/orphan/port collision, independently bad assets/auth and external writer scenarios |
| Faults | Simulated before/after journal and data-rename cases; 17 audited real SIGKILL boundaries and real VM resets before/after commit | Full real reboot matrix at every boundary; SIGKILL within writes/fsync and both rollback data-renames; real corrupt-evidence and failed-rollback injection |
| Browser | Actual matched screenshots and rendered desktop/mobile lost-response/reload/two-tab/cancel/reauth cases; draft persistence tests | Full authenticated systemd lifecycle in the browser, rollback reauth and stale-asset recovery; assistive-technology and additional mobile-browser validation |

Disposable VM infrastructure is now available, so it is **not** the remaining
blocker. Qualification needs the additional fixtures/runs above and an authorized
compatible release test source; no publishing/release was authorized in this
assignment. No additional production updater code is intentionally deferred to
that runner. Keep the build gate false and the PR draft until the complete design
acceptance matrix, including browser-to-helper lifecycle, is verified. These
results do not promise zero downtime or recovery from arbitrary later bugs,
publisher compromise, external effects or storage failure.
