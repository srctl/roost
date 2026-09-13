# Jobs PR separation verification

Review / landing dependency: [threads #22](https://github.com/srctl/roost/pull/22) → [#23](https://github.com/srctl/roost/pull/23) → [#24](https://github.com/srctl/roost/pull/24) → [Jobs #31](https://github.com/srctl/roost/pull/31) → [#32](https://github.com/srctl/roost/pull/32) → [#33](https://github.com/srctl/roost/pull/33).

Original Jobs #27/#28/#29 are marked superseded, remain open for history, and retain all original descriptions and attachments. Original branches and thread PRs are unchanged. The replacement PRs are ordinary dependent PRs, not a newly linked native stack. Prerequisites must land first; no PR was merged and no merge endpoint was called.

| Replacement | Original | Diff files | Added | Deleted | State |
| --- | --- | ---: | ---: | ---: | --- |
| #31 storage | #27 | 9 | 1086 | 101 | Draft |
| #32 UI | #28 | 7 | 1514 | 293 | Draft |
| #33 integration | #29 | 23 | 1005 | 231 | Ready |

Final head `5fabd42f5cffd07b20adb04af4d37f222e7f34e4` has tree `6aa4d233cf8b13ad868539b035fa44a2e72fbd67`, exactly equal to original `e06f198f2a511bf52157eaefa6b9806939d3714f`. All source, tests and documentation are identical in the aggregate. The existing schema-v13 test expectation was moved from integration to storage to reflect its new prerequisite. UI-layer application code is identical to original combined dependency commit `fc9b68d`.

The documented [gh stack modify](https://docs.github.com/en/pull-requests/reference/stacked-prs-cli-commands#gh-stack-modify) requires linear history; the original native Jobs stack includes merge `fc9b68d`. Replacement branches avoid force-pushing/rebasing original refs or changing the active preview checkout.

## Verification

- Both intermediate layers: 18 coding/workspace/schema tests, lint and typecheck passed.
- Aggregate: 181 tests, lint, typecheck, application/CLI builds passed.
- Production auth smoke passed: enrollment, login, private pages/API, desktop upgrade, revocation and recovery.
- Site typecheck, 6 docs tests, marketing/docs builds passed.
- All pnpm check stages completed; auth/sites were finished separately after isolating inherited listener environment variables.
- Initial environment issues: restrictive inherited umask affected a synthetic packaging fixture (180/181 passed on that attempt); standard process-local umask 022 produced 181/181. Inherited NITRO_PORT/NITRO_HOST prevented auth's random fixture port from being used; removing these only for the test resolved startup. No source fix.
- Remote base/head and every file's additions/deletions match local Git. See remote-verification.json.
- All 42 original Jobs attachment URLs downloaded successfully. See attachments-verified.json for byte lengths and SHA-256 hashes. Original desktop/mobile before/after captures and recordings remain embedded in replacement PR bodies.

This follow-up changes history/review boundaries only. Browser checks were not rerun or recaptured; prior actual-rendered evidence remains applicable. Prior simulated-worker/browser-device limitations remain. The other worktree's port4322 preview, process, checkout, data, dependencies and evidence were not modified. No deployment, Notes work, or live storage/config changes.

Task-local verification outputs are disposable. The coordinator must verify worker exit and no unique uncommitted files before removing the task worktree; keep the preview and primary checkout.
