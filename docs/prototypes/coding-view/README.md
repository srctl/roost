# Coding work monitor — research prototype

Recommend a **read-only selected-job monitor over Roost’s existing snapshots**, then evaluate a resumable event stream. Borrow Rove’s session navigation and connection-state patterns. Adopting its Pi runtime/control plane is a separate project, not a shortcut to monitoring Codex.

This directory is an isolated, rendered React prototype. It adds no production route, server endpoint, dependency, terminal input, worker launch, or live storage access. All output, jobs, timestamps, approvals, and replay results are fixtures. The terminal-looking panel is plain text, not a terminal emulator.

## What exists today

Inspected Roost at [`3f7bae2`](https://github.com/srctl/roost/tree/3f7bae287253e1c4c5449ea78521b2fcc072152d), and Rove read-only through GitHub at [`f39ec20`](https://github.com/srctl/rove/tree/f39ec202338c7abf53fda4bf8cb842b2f67735e3), on 2026-09-08. No Rove service was installed or contacted.

- Roost’s [Jobs route](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/src/routes/agents.%24agentId_.jobs.tsx) uses expandable job rows and nested output disclosure. It refreshes visible pages every 4 seconds with active jobs, otherwise 15 seconds. Users must expand each job to see its session and output; refresh does not represent a live terminal connection.
- The [worker scheduler](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/src/server/runs/worker.server.ts) schedules coding ticks at approximately 5-second intervals. [Coding polling](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/src/server/coding/worker.server.ts) batches work and separately maintains `lastCheckedAt`. Polling/SSH delay and backlog mean this is not a latency guarantee; `updatedAt` is not a connection heartbeat.
- The [Herdr adapter](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/src/server/coding/herdr.server.ts) reads 200 `recent-unwrapped` text lines, truncates to the last 24,000 characters, and rechecks session identity after capture. These are overlapping, replaceable snapshots, not append-only events or ANSI frames. A browser cannot safely infer missing history or command boundaries from them.
- The [job schema](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/src/features/coding/schema.ts) already has machine, workspace, worker/session identifiers, status, summary, error, and observation timestamps. The prototype reorganizes this information rather than inventing a production telemetry source.

## Options and tradeoffs

| Approach | Practical benefit | Cost / boundary | Recommendation |
| --- | --- | --- | --- |
| Existing snapshots, selected-job panel | Smallest change; Codex and other existing Herdr workers; readable/copyable output, context and attention visible together | Poll latency; truncated output; redraws; no exact tool timeline | First production experiment, after UX review |
| Server-sent events (SSE) carrying text snapshots/status | One-way updates fit monitoring; browser reconnect support; retain current worker ownership boundary | Need authenticated endpoint, sequence/resume/reset protocol, bounded buffering, heartbeat, expiry and proxy testing; streaming current snapshots alone does not make Herdr capture faster | Next transport spike if polling feels inadequate |
| xterm.js with a read-only WebSocket feed | Faithful ANSI/cursor/TUI rendering if a real frame/byte source is available | xterm.js is a renderer, not a worker transport. Current text tails cannot reconstruct terminal state. Must validate observer support, scrollback, resize ownership, backpressure and reconnect | Defer until terminal fidelity is a demonstrated need |
| Rove UI patterns / selected code | Session list, connection states, live semantic events, history reconciliation | Different styling stack; Pi-specific event/history model; reuse licensing and dependencies need review | Borrow interaction ideas now; evaluate small modules separately |
| Rove relay/runtime integration | Existing encrypted remote discovery and Pi session workflow | Enrollment, device keys, host daemon, relay, account/session mapping, revocation and Pi extension; Codex adapter absent from inspected runtime design | Separate proposal only if shared remote-session infrastructure is wanted |

[SSE documentation](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) describes unidirectional events, IDs and reconnect behavior; HTTP/1 connection limits argue for multiplexing selected job updates rather than one connection per row. [xterm.js security guidance](https://xtermjs.org/docs/guides/security/) treats terminal data as untrusted and requires explicit transport authorization; hiding an input widget does not remove server-side control capability.

Rove’s [README](https://github.com/srctl/rove/blob/f39ec202338c7abf53fda4bf8cb842b2f67735e3/README.md) distinguishes its semantic web UI from desktop terminal attachment. Its [architecture](https://github.com/srctl/rove/blob/f39ec202338c7abf53fda4bf8cb842b2f67735e3/docs/architecture.md) specifies a Pi extension, local Unix socket, one outbound host relay connection, signed E2E traffic and expiring authorization leases. Its [workspace implementation](https://github.com/srctl/rove/blob/f39ec202338c7abf53fda4bf8cb842b2f67735e3/apps/control/web/workspace.ts) subscribes before loading history and merges buffered events. Its [protocol](https://github.com/srctl/rove/blob/f39ec202338c7abf53fda4bf8cb842b2f67735e3/packages/protocol/src/messages.ts) includes prompt, steer, stop and delete commands alongside reads: wholesale reuse would import control semantics. Its [SSH terminal bridge](https://github.com/srctl/rove/blob/f39ec202338c7abf53fda4bf8cb842b2f67735e3/apps/cli/src/remote-terminal.ts) acquires terminal control and forwards input/resize, so it is not an established passive browser observer API. These are source findings, not runtime interoperability tests.

## Proposed integration boundary (not implemented)

Browser monitor ← authenticated Roost read endpoint ← job-scoped snapshot/event adapter ← existing Herdr observer on local/SSH worker.

Keep the current job identity checks and coordinator lifecycle authoritative. A future envelope could contain `jobId`, `sessionIdentity`, monotonic `sequence`, `observedAt`, `kind: snapshot|status|reset`, and a bounded text payload. Replace snapshot text rather than appending overlapping tails. Reconnect with a cursor; explicitly reset when history expired or identity changed. Show last observation age and disconnected/unknown separately from the persisted worker state. Disconnecting a viewer must never stop a worker.

Follow Roost’s [HTTP auth gate](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/src/server/auth/http.server.ts) and study its existing [desktop socket session checks](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/src/server/computer/socket.server.ts). Revalidate job access and session expiry on long-lived connections; constrain origins, payload size, subscriptions and slow consumers. Resolve the authorized job server-side rather than accepting arbitrary host/pane targets. Do not pass shell credentials, control tokens, or query-string bearer secrets to the browser. Render untrusted output as text, disable unsolicited links/clipboard escape actions, and decide redaction and retention before durable output logging. No stream should be cached by service workers or shared proxies.

An approval state should identify the existing terminal/session and explain the required user action. No generic “Approve”, stdin, resize, or control-message forwarding belongs in this monitor. [Roost’s documented workflow](https://github.com/srctl/roost/blob/3f7bae287253e1c4c5449ea78521b2fcc072152d/docs/coding-agents.md) keeps blocked approvals in the original worker terminal and distinguishes idle/review from completion. A future Stop affordance should retain the existing explicit stop workflow, not synthesize terminal keystrokes.

## Review decisions and limitations

1. Validate the selected-job layout and whether mobile should switch between list and detail instead of stacking them. The fixture uses three jobs; pagination, search, empty/error states and large job lists remain follow-ups.
2. Agree on freshness language, output retention/redaction, and how much history people need. No real transport latency, terminal compatibility, screen-reader audit or load testing was performed.
3. Ship the layout over the existing read API only after separate implementation approval. Then measure polling behavior before choosing SSE or a passive terminal observer spike. Verify documented Herdr observer capabilities first; do not use Rove’s control bridge as a shortcut.
4. Decide whether Rove interoperability is an actual product requirement. If so, scope Codex event adaptation, account/job mapping, licensing, and key custody independently. Nothing here enrolls machines or changes approval/security policy.

## Run and verify

From the repository root, after `pnpm install --frozen-lockfile`:

```sh
pnpm exec vite --config docs/prototypes/coding-view/vite.config.mjs
# http://127.0.0.1:4178/                  proposed monitor
# http://127.0.0.1:4178/?view=baseline   existing Jobs content
pnpm exec vite build --config docs/prototypes/coding-view/vite.config.mjs
pnpm exec tsc --project docs/prototypes/coding-view/tsconfig.json
```

The config extracts existing `AgentJobs`, `JobDetails`, helpers and StyleX styles into ignored `.baseline.tsx`. Router refresh and stop functions are inert fixtures; the actual agent header and application shell are replaced by a shared presentation harness in both views. This is an actual browser rendering of existing Jobs **content**, not a capture of an authenticated live installation. The generator intentionally type-skips the extracted module's stubbed router boundaries; the production source and prototype are typechecked separately. Production builds do not include this directory. The prototype build writes only `/tmp/roost-coding-view-build`.

Capture with a separately installed Playwright (no project dependency added):

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROME_PATH=/path/to/chrome \
node docs/prototypes/coding-view/capture.mjs
```

This VM used `CHROME_NO_SANDBOX=1` for headless fixture capture. Screenshots use light mode, UTC, device scale 1, desktop **1440×1100** and mobile **390×844** viewports. Both pairs show the same three jobs and the selected running assignment's initial output; the baseline job and output disclosures are open. Full-page image heights differ because the layouts differ. Additional attention/disconnection images exercise simulated states.

Validation on 2026-09-08:

- `pnpm lint` equivalent (`node node_modules/@biomejs/biome/bin/biome check --error-on-warnings .`): passed.
- App `tsc --noEmit` and prototype `tsc --project docs/prototypes/coding-view/tsconfig.json`: passed.
- `env -u ROOST_CODEX_BINARY node --import tsx --test tests/coding-*.test.ts`: **48/48 passed**. Initial restricted-sandbox run failed in two files with the inherited worker binary override; clean-environment execution outside the process sandbox passed. Tests use their own temporary data and mocked workers.
- App `vite build`, CLI `vite build --config vite.cli.config.ts`, and isolated prototype build: passed. Existing Vite config-loader forward-compatibility warning remains.
- `capture.mjs`: passed replay, disconnect/reconnect, follow toggle, job-output isolation, attention/review states, mobile overflow and zero browser errors/API requests. Desktop/mobile images visually inspected.
- No full unrelated suite, production auth integration, real streaming benchmark or Rove runtime test was run for this docs-only prototype.

## Rendered screenshots

| State | Desktop | Mobile |
| --- | --- | --- |
| **Before: actual existing Jobs content, fixture harness** | [Before desktop](screenshots/before-desktop.png) | [Before mobile](screenshots/before-mobile.png) |
| **After: proposed monitor, same fixtures** | [After desktop](screenshots/after-desktop.png) | [After mobile](screenshots/after-mobile.png) |
| Simulated attention | [Desktop](screenshots/attention-desktop.png) | [Mobile](screenshots/attention-mobile.png) |
| Simulated connection loss | [Desktop](screenshots/disconnected-desktop.png) | [Mobile](screenshots/disconnected-mobile.png) |
