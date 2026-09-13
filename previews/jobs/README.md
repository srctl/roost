# Jobs workflow design preview

This is the first feedback milestone, not production acceptance. It is a separate
client-only Vite entry. The current Jobs route, server functions, database and
worker runtime are unchanged. All jobs, progress, previews and PR destinations
are explicitly simulated. No server APIs, credentials or agents are imported.

Run from the repository root after installing its locked dependencies:

```sh
node node_modules/vite/bin/vite.js --config previews/jobs/vite.config.ts
node_modules/.bin/biome check previews/jobs
node_modules/.bin/tsc -p previews/jobs/tsconfig.json
node_modules/.bin/vite build --config previews/jobs/vite.config.ts
```

The private task URL is `https://roost-dev.exe.xyz:4322/`. Vite uses strict port
4322, binds for the documented extra-port proxy, and allows this hostname only
in addition to Vite's local defaults. It does not change the main proxy or port
3000. Build output goes to `/tmp/jobs-preview-build`. Optional local `public`
evidence is ignored by git. Keep this worktree and the preview running throughout
feedback; normal post-PR cleanup does not apply at this milestone.

## Interaction choices

- Compact rows show title, workflow state, latest update, and the relevant action.
- Opening a title navigates to a job workspace; browser Back and direct hash
  links work. Desktop places discussion beside work; mobile stacks them and
  offers a feedback shortcut. Technical output is collapsed by default.
- Preview availability is independent of job status. An unavailable preview
  does not complete, cancel or block a job by itself. There is no closed-preview
  landing page. Example destinations open a clearly labeled modal.
- Saving feedback does not resume a paused assignment. An explicit continuation
  simulates resuming the same assignment and worker. It never creates a job.
- Feedback, drafts and simulated state persist in sessionStorage for the current
  tab and survive reload. This is demo convenience, not durable job discussion.
  Reset demo clears only this prototype's state. No send or dispatch occurs.
- Review PR is primary for verified review fixtures; Open preview is primary
  during iteration. Standalone review and aggregate integration verification
  are visibly distinct. Completed work remains discoverable.

## Existing architecture and integration boundaries

At base `7415789`, `src/routes/agents.$agentId_.jobs.tsx` reads `getCodingJobs`,
polls while visible and calls `stopCodingJob`. It renders an expandable list;
there is no persistent preview metadata or job discussion interface.

`src/features/coding/schema.ts` separates launch fields (assignment, brief,
sourceRunId, workspace, worker) from runtime fields. `store.server.ts` persists
jobs in SQLite with revisions and creation request collision checks.
`jobs.server.ts` scopes authorization to the originating coding run and job;
`continueCodingJob` uses unique follow-up request IDs and `coding_job_inputs`,
rejects mismatched retries and pending duplicates, and preserves the original
assignment. Owned session identity and launch recovery live in the worker/Herdr
boundary. Preview processes must never be used to infer those states.

Current worker readiness can produce `review`, which is not proof of verified
implementation. `completeCodingJob` is a separate coordinator decision. A new
feedback pause must survive worker polling and automatic coordinator notices,
not merely relabel `review` in the UI.

Read-only inspection of PR stack #22 → #23 → #24 at `ee30154`:

- `conversation_records` owns product conversation IDs independently of native
  worker/provider IDs. Runs, sends and notifications carry conversation identity.
- `openReplyThread` / `openThread` currently opens one child for a main-conversation
  user/assistant message; arbitrary job-owned roots are not supported.
- Link a job to a durable conversation ID using an explicit adapter. Decide whether
  to anchor it to the originating main message or extend the abstraction for
  jobs originating inside child conversations or outside chat. Do not introduce
  a second discussion store or fabricate a parent message.
- Preserve thread tombstones, send retry collision handling, scoped approvals,
  cancellation and origin notification routing. Thread send is not worker input:
  discussion first reaches the coordinator, which dispatches within the original
  task's authorization using an idempotent continuation request.

PRs #20 → #21 remain unmerged too. Their shared Note interface adds an agent
header destination; shared notes are not job discussions. No files, worktrees,
branches or migrations from either stack were adopted or modified.

## Planned reviewable implementation layers after feedback

1. Persist preview records (job ID, URL, revision, availability, observation time,
   owner) and explicit workflow/verification state. Validate safe URLs and keep
   preview liveness orthogonal to execution and completion. Test stale updates,
   stopped preview, restart recovery and revision conflicts.
2. Add the job/conversation association against the thread stack, with safe
   discussion sends and coordinator continuation. Test retries, ambiguous
   dispatch/recovery, cancellation, unchanged assignment/worker identity,
   same-job scope, and return-to-feedback after restart.
3. Connect the accepted workspace UI to those APIs while retaining current
   refresh, stop, error, empty and non-coding behavior. Replace all fixture
   destinations. Verify keyboard/mobile interaction, standalone checks, aggregate
   integration and migration compatibility before treating PR review as final.

Open design choices for feedback: list density, mobile discussion placement,
save-versus-continue language, and how unavailable previews offer a resume action.
Open technical dependency: exact job-thread origin representation, authoritative
preview reporter and heartbeat/expiry rules. Choose within the original task's
scope after UI feedback; do not merge the dependent stacks as a shortcut.

## Design-system iteration r04

The accepted workflow remains fixture-only. The preview now imports the production
`Button`, `Avatar`, and `Icon` components and the Base UI Dialog primitive
used by Roost’s existing dialogs. `theme.stylex.ts` bridges the actual
Roost color and motion tokens into the isolated layout, including system dark
mode and custom `--roost-*` overrides. No independent color palette is maintained.
The 13px app font stack, 216px sidebar, agent identity, underlined view navigation,
28px desktop/44px mobile buttons, compact text hierarchy, and 14px composer with
focus-within treatment follow App, Sidebar, AgentHeader and Composer.

The shell is a fixture adapter of those layouts, not the live App/Sidebar:
those components import router loaders, activity and settings that must remain
outside this client-only preview. Conversation is a noninteractive context label;
only Jobs and the fixture agent are navigable. Sidebar collapse and the mobile
navigation dialog are local interactions. Notes and execution settings remain
outside this iteration. The former decorative copy, monogram, mock browser,
serif illustration and separate green button palette were removed.

Desktop/mobile screenshots compare r03 with r04 at identical viewport dimensions,
fixture state and browser color preference. The old r03 did not implement dark
mode. Keyboard checks cover modal focus containment/return, mobile navigation,
sidebar toggle focus, task navigation and feedback field focus. Preserve this
iteration's evidence alongside the original milestone evidence until eventual
PR attachments are uploaded. Production backend and full app integration checks
remain outside this feedback milestone.
