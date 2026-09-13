# PR #36 — plain default navigation refinement

PR: https://github.com/srctl/roost/pull/36
Branch: feat/agent-rename
Final head: 185063234c9870160a76d76cdec0f85ee9de62e1
Tested rebase base: 0f0e818 (Notes backend PR #20). Latest fetched main: 3fd052f (Notes UI PR #21); migration/store interfaces are byte-identical to tested 0f0e818, and GitHub confirms this PR remains MERGEABLE. No second schema integration needed.

Removed the Ungrouped navigation heading on desktop/mobile. Default agents remain plain links with no label, box or new visual treatment, both with zero sections and with sections present. Only created sections have labels. The management select retains Ungrouped. No ordering, routing, draft or styling changes.

The branch was rebased onto current main; the store conflict was resolved by keeping Notes migration and navigation savepoint inside the existing core14 transaction and preserving both error mappings. No PR merge or deployment occurred. Original legacy-core13 and current-core14 tests cover upgrade/data preservation. Notes interfaces at integration/notes-approved b88809d match main's inspected migration contracts.

## Final verification

- Full `pnpm check` passed (exit 0): lint, TypeScript, 205 tests, app/CLI builds, production authentication, sites TypeScript, 6 sites tests and both site builds.
- Updated desktop/mobile browser suite passed on final production build; captures independently assert zero/with-section states and unchanged route/draft.
- Focused navigation + Notes + schema-upgrade tests passed. Both core13 upgrade and actual core14 Notes preservation/rollback are covered.
- `git diff --check` passed. Remote feature head matches and PR #36 is MERGEABLE.

Browser assertions cover desktop/mobile plain default list before creation, with a section, and after deletion; retain management option, agent order/UUID routes, active main/reply drafts, section collapse/move/delete and lost-response retry/auth coverage.

Screenshots: original six final-state after captures refreshed; eight additional matched captures show before/after at zero sections and section present (desktop 1440x1000, mobile 390x844). Actual Chrome, same isolated fixture UUIDs/content/active agent/draft/theme/viewport per pair. Before-refinement head 7ae52d9. Old evidence is preserved in branch history.

## Cleanup/handoff

Completed: node_modules, app/site build outputs, dependency store, before/after source copies and check fixtures removed. Git worktree is clean (including ignored outputs). No task-owned test/browser/build processes remain. Logs/HANDOFF and screenshots remain outside the worktree and on the evidence branch; retain clean worktree for coordinator removal.

No live user data, unrelated worktrees or preview processes changed. Keep the managed session open for coordinator completion recording. Coordinator removes the clean task worktree after the worker is no longer using it.
