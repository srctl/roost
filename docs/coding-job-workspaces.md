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
Availability is a timestamped report, not a health check; the app does not fetch
arbitrary preview URLs or start/stop preview infrastructure. HTTP(S) links reject
embedded credentials and executable schemes.

The coding coordinator reads `roost_get_coding_workspace` and writes
`roost_report_coding_workspace` within the existing active-run/job authorization.
A feedback pause requires an idle/review worker with no pending input. Worker
polls preserve the separate pause, and autonomous coding-result runs cannot
continue, complete or clear that pause. A newer explicit user conversation or
Jobs continuation can resume. A review report requires PR URLs and nonempty
verification evidence; this is a coordinator assertion, not a CI attestation.

Saved feedback is an existing timeline notice, linked through
`coding_job_feedback` (IDs, preview revision, timestamp, delivery association).
Saving does not enqueue a chat run, steer a conversation or send worker input.
The detail view lists these job-linked notices; feedback remains visible in the
agent conversation too. Content is not duplicated in a new discussion store.

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

Read-only inspection used the unmerged #22 → #23 → #24 interfaces at `ee30154`:
`conversation_records`, `openReplyThread`, `runConversationId`, conversation-scoped
sends/timeline and tombstones. This implementation uses the main-conversation ID
(agent UUID) as the bounded v10 adapter. It does not copy thread code or manufacture
parent messages. Dedicated child-thread creation, scoped coordinator replies,
notifications and child-origin jobs remain dependent on that stack. The current
workspace discussion is saved feedback plus job updates, not a separate live
assistant thread. #20 → #21 Notes and execution settings remain outside scope.

The additive migration has its own `coding_workspace_versions` marker. It creates
only feature-owned tables/indexes and does not consume numeric versions 11–13,
alter thread/note schemas or rewrite jobs/runs/history. Core `user_version` remains
10. This is standalone compatibility, not permission to open a thread-stack
schema with this older core: the existing newer-core-version fence remains.
When integrating the stacks, retain this additive migration and reconcile the
shared `jobs.server.ts`, server functions and core store changes. Do not run an
older worker against a paused-workspace database: older code does not enforce
feedback pauses. Full aggregate thread/note integration is not yet verified.

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
