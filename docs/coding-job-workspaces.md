# Coding job workspaces

Jobs now opens an assignment workspace inside the existing Roost app. The compact
list retains refresh, errors, empty/non-coding states and stop controls. Detail
URLs use `/agents/:agentId/jobs?job=:jobId`. Preview links are primary during
iteration; a verified workspace with PR links makes Review PR primary. Terminal
execution states remain visible. A ready worker without verification is not
labeled ready for PR review.

## Durable state and authorization

`coding_job_workspaces` stores a revisioned preview URL/current revision/reported
availability, workflow (`working`, `feedback`, `review`), latest changes, PR links,
verification evidence and independent integration verification. Execution remains
in `coding_jobs`. Stopped or unavailable previews never complete/cancel jobs.
Availability is a timestamped report with a **15-minute lease**, not a health
check. Only `roost_report_coding_workspace` renews `previewReportedAt` and
`previewExpiresAt`; unrelated workflow writes do not. Missing, future-dated,
overlong or expired leases display **Unknown** and lose the running primary
CTA. A clearly labeled **Try last preview** link preserves discovery. The UI
rechecks time every second even if refresh fails; returning to a tab rechecks it.
Known offline state suspends route refresh so the app’s auth revalidation cannot
replace the workspace with a network error. Failed job reads retain the last
loaded list with an error; this is not an offline mutation queue.
The workspace read API also returns the effective `previewStatus`. No arbitrary
URL fetching, auth bypass, background model polling or preview infrastructure
control is introduced. HTTP(S) links reject embedded credentials and executable
schemes. A preview can fail before its lease expires; “Reported running” is not
an uptime guarantee. A later confirmed report restores that indication.

The coding coordinator reads `roost_get_coding_workspace` and writes
`roost_report_coding_workspace` within the existing active-run/job authorization.
A feedback pause requires an idle/review worker with no pending input. Worker
polls preserve the separate pause, and autonomous coding-result runs cannot
continue, complete or clear that pause. A newer explicit user turn in that job discussion or
Jobs continuation can resume. An unrelated main/sibling turn cannot release it. A review report requires PR URLs and nonempty
verification evidence; this is a coordinator assertion, not a CI attestation.

Saved feedback is an existing timeline notice, linked through
`coding_job_feedback` (IDs, preview revision, timestamp, delivery association).
Saving does not enqueue a chat run, steer a conversation or send worker input.
Saved feedback lives only in the job's conversation. “Worker feedback” keeps
selection and delivery receipts compact; “Talk to agent” uses the existing
`Conversation` component, scoped chat API, native session and run queue. That
chat can discuss the task without submitting saved feedback automatically.
Replies, workspace updates and notifications stay in the job conversation;
notification URLs reopen it using the existing conversation query. No parallel
message store or new agent identity is introduced.

Explicit continuation sends selected, previously unsent feedback through the
existing `coding_job_inputs` dispatch path. The transaction checks agent/job
ownership, current job revision, ready worker identity, unique selected IDs,
existing submissions and request-ID/content collisions. UI continuation cannot
retry an initial launch or answer terminal approvals. The core worker still
verifies ownership before dispatch. Assignment, brief, workspace and session IDs
are preserved; no new job is created. Subsequent polls expose queued/sent/failed
status. Failed or uncertain submissions are never silently replayed. The user
must inspect a failed delivery and provide a fresh, explicit instruction if
needed. UI request IDs/drafts survive reload in per-job session storage; server
receipts remain durable after that browser state is gone.

## Thread and migration boundaries

Remote inspection on 2026-09-13 confirmed #22 → #23 → #24 remain open, at
`d88cc45`, `4ed0831`, and `ee30154`. The integration branch explicitly combines
that inspected dependency with Jobs #27 → #28. Original branches are preserved;
no thread migration was copied and nothing was merged to main. Review the
bounded integration commit separately from its dependency merge, then verify the
aggregate. This layer requires the thread stack and cannot ship independently.
#20 → #21 Notes and execution settings remain out of scope and are not part of
this verified aggregate.

Each job owns a `conversation_records` entry keyed by its existing job UUID,
without a manufactured parent message. This is a job conversation, not a nested
reply thread. The original `sourceRunId`, assignment, request, workspace and
worker/native-session identity remain unchanged, including for jobs originating
in reply threads. New coding-report runs and notices target the job UUID;
completed historical reports retain their old provenance. New job sessions get
the assignment and bounded same-agent context as quoted context, and use
`roost_read_conversations` for main/sibling awareness. A job conversation cannot
launch another job, modify execution settings or act on a different job.

Capability version 14 refreshes native coordinator sessions from thread-stack
v13 so the workspace tools are available; archived messages keep their IDs.
This is independent of schema versions and never replaces a coding worker.

Core migrations 11–13 are the dependency's original migrations. Feature-keyed
`coding_workspace_versions` v2 runs after them: it creates conversation records,
moves only known saved-feedback messages and queued report notices, reroutes
queued report runs, and binds workspace metadata. It preserves message IDs,
positions, feedback delivery associations, job/run/worker identities and
historical results. Preflight refuses an active old coding-report turn before any core schema change,
with an actionable error; finish or stop those turns on the old runtime before retrying.
The feature transaction rolls back on collision or failure. Never run old and
new workers against the same upgraded store or downgrade this database.
Tombstones fence new feedback/chat/continuation and suppress new report wakeups;
worker state and the user's Stop control remain available without resurrecting
the discussion.

`tests/coding-discussion.test.ts` exercises actual chat-worker replies and
notification routing with the local fake provider, shared-context retrieval,
same-job pause release, tombstones, bounded report expiry and repeatable
core-v10/v13 + workspace-v1 upgrades. It also tests the active-report upgrade
fence and queued routing without replay. Existing thread migration, routing,
provider/session, notification and coding identity regressions run in the same
aggregate. All test stores are disposable, with no live data or real workers.

## Isolated real-app feedback preview

`tests/fixtures/jobs-preview/vite.config.ts` extends the normal app config. It
requires a newly seeded `/tmp/roost-jobs-app-preview-*` directory and marker before
startup. Only that test config aliases the Herdr transport to a simulator; the
normal build contains the real transport. The simulator refuses other storage,
never invokes shells/SSH/agents, rejects new worker launches, and simulates a
same-worker revision after submitted feedback. A separate fake Codex binary and
empty provider home prevent access to live credentials. Desktop integration is
unset. All settings, messages, requests and worker effects are test-only.

Seed with `node --import tsx tests/fixtures/jobs-preview/seed.ts`; the generated
path is recorded in `/tmp/jobs-app-preview-directory`. Start Vite using the fixture
config with `ROOST_DATA_DIR`, `ROOST_CODEX_BINARY=<fixture>/fake-codex`, and
`CODEX_HOME=<fixture>/codex`. The coordinator handoff records the complete minimal
environment and owned PID. The private URL stays `https://roost-dev.exe.xyz:4322/`.
The fixture-only root redirect opens the actual Jobs route; sample preview/PR
links open an explicitly simulated destination. Port 3000 and host proxy/auth
configuration remain untouched. Do not use this test config for a deployment.

The earlier standalone prototype was removed; its historical source remains in
the task branch history and its evidence is retained outside the source tree.
Actual before/after captures render the original and implemented Jobs routes in
the real App/Sidebar/AgentHeader with matched desktop/mobile data and viewport.
Keep the task worktree/runtime during user feedback. Attach evidence to review
PRs before final cleanup; do not create evidence branches or commit recordings.
