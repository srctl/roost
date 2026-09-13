# Agent rename and navigation sections handoff

PR: https://github.com/srctl/roost/pull/36
Feature branch: feat/agent-rename
Tested/pushed head: 7ae52d9d6c389ca04b4262161d0692d785da1f58
Base: origin/main ed3ca2e (refetched before PR; PR reports OPEN and MERGEABLE)
Screenshot evidence: https://github.com/srctl/roost/tree/071378b8f0ced0d0cb5ccc9e0897fa123b36ad33
Evidence branch: evidence/agent-rename-sections (separate from feature source diff)

## Delivered

Agent settings display-name editor, trimmed 1–60 character shared validation, save/cancel/errors, immediate route refresh. Navigation sections support create/rename/delete, single optional membership, Ungrouped, persisted collapse and deterministic creation ordering. Section creation retries preserve UUID after lost response. Section deletion never deletes agents. Stable agent UUIDs, conversations, threads, jobs, automations, notes, files, links, soul content, disk paths and private state are preserved. Instance-wide sections follow existing auth and do not confer permissions. One shared PR avoids duplicating editor/refresh/schema/browser infrastructure.

## Verification

PASS on final committed source:

- Full `pnpm check`, exit 0: lint, typecheck, 185 tests, app/CLI build, production auth, sites typecheck, 6 sites tests, marketing/docs builds.
- Exact environment: process-local `umask 022`; `env -u NITRO_PORT -u NITRO_HOST -u ROOST_CODEX_BINARY -u ROOST_HERDR_BINARY -u HERDR_SOCKET_PATH -u ROOST_RUN_ID ROOST_DATA_DIR=/tmp/agent-rename-check-fixture CODEX_HOME=/tmp/agent-rename-check-codex npm exec --yes --package=pnpm@9.15.0 -- pnpm check`.
- `node --import tsx tests/agent-navigation.test.ts`: 3 focused persistence/validation/migration/data-preservation tests.
- `ROOST_TEST_CHROME=/usr/bin/google-chrome node --import tsx tests/browser/agent-navigation.ts`: desktop/mobile rename validation/cancel/save, create/move/rename/delete sections, persisted collapse, active URL and main/reply draft continuity, no horizontal overflow, compiled mutation 401/403/session behavior. Desktop dark and mobile light. Simulated committed create with failed response verifies same UUID and exactly one section on retry.
- Notes compatibility smoke composed in a disposable copy at integration/notes-approved 8dc63e8d75badc1c50868267d8e3c4a0e51e3dcc: original core13 fixture upgraded to Notes core14 plus navigation; rename/group/delete preserves actual agent_notes, note_revisions and main conversation ID.
- `git diff --check`; remote feature head matches; GitHub evidence tree contains 12 PNGs and checked raw links return HTTP 200.

Initial test attempts exposed inherited managed-environment assumptions (live Codex binary override, restrictive umask, Nitro port). Retried in isolated environment. One auth retry overlapped a rebuild; a disposable diagnostic helper exposed the startup problem, and the unmodified auth script plus final full check passed. No host configuration changes or live data changes. No outstanding feature failures. Existing build deprecation/config warnings are nonfatal.

## Evidence and reproducibility

Actual Chrome before/after screenshots have identical fixture UUIDs, content, typed draft, light theme and viewports: desktop 1440x1000, mobile 390x844; conversation/settings/navigation views. After settings opens the new editor in the same settings sheet. Baseline ed3ca2e; final retry fix has no visual changes. Images embedded in PR and on separate evidence branch; no logs, screenshots or disposable helpers in feature diff.

Concise useful logs retained here: check-final.log, retry-browser-tests.txt, retry-unit-tests.txt, notes-compat.log. Capture/helper files and troubleshooting logs also retained locally outside worktree. Committed tests are canonical runnable verification.

## Integration and assumptions

Core remains v13 in this PR. Navigation has its own feature version and savepoint migration, compatible with the Notes branch's outer core14 transaction. When combining Notes and this PR, retain migrateAgentNavigation(db) and AgentNavigationMigrationError mapping in store.server.ts. No dependency PR required on current main. Existing agents are ungrouped; agents retain creation order, sections use creation position/UUID. Collapse is instance-wide navigation metadata. No nesting/multiple memberships, drag-and-drop or permissions feature added.

## Cleanup

Completed: task node_modules, .output, marketing/docs dist, pnpm store, baseline/after/Notes compatibility copies, test data/Codex directories, and stopped fixture leftovers removed. `git status --short --ignored` is empty. Logs/HANDOFF and remote screenshots remain accessible. The worktree itself MUST remain for coordinator removal: the managed Herdr/Codex worker is still active here. Do not close its managed session before completion is recorded. No task-owned build/test/browser processes remain. Preserve the feature/evidence branches and remote PR. No unrelated branches/worktrees or live preview processes were modified.
