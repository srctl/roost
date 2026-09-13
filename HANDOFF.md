# Approved three-PR integration

Status: all three approved PRs merged; final main exactly matches the tested tree.

## Authorized scope

Only PR12 (agent deletion), PR36 (rename/navigation sections), and PR37 (direct job-worker composer) may merge. No release, deployment, live-host changes, real agent deletion, or Notion/Roost updates. All fixture databases are separate from existing previews.

## Starting state

- Main: `25adfc6b7e34ce991e341cc016cce34f6f34f21b`.
- PR12: `7bb621ee221a2962e8f5bcec564fb5c0b8ad3bb0`, `feat/delete-agents`.
- PR36: `185063234c9870160a76d76cdec0f85ee9de62e1`, `feat/agent-rename`.
- PR37: `2aa050c1220efe4263e662a77e9a987882c5ef1d`, `codex/task-job-page-worker`.
- Live GitHub confirmed all open, non-draft, targeting main. PR12 conflicted; PR36/37 mergeable. No GitHub status checks were configured on these heads.
- Prepared worktree: `integration/approved-delete-sections-composer`.
- Herdr client/server 0.9.0, protocol22 compatible. One Codex0.154.0/Astra implementation agent, `approved-integrator`, in a new sibling pane. Existing workers remain untouched.

## Preserved evidence and previews

- All 26 GitHub image attachments/raw screenshot links in PR12/36 returned HTTP200; byte counts and SHA256 in `existing-attachments-check.json`.
- All five preview origins returned HTTP200: composer4342/4344, deletion4346, sections4336, reply4327. Baseline process IDs in `previews-before.txt`.
- Both composer revision endpoints still identify approved PR37 head `2aa050c1220efe4263e662a77e9a987882c5ef1d`.
- Existing PR37 media download returned HTTP200, 3,750,035 bytes, SHA256 `e33b9e28b3ff159e610faa35ed1a937972defb3571565a283011a49631615864`, matching its prior handoff.
- Existing PR37 media remains at `/home/exedev/review-artifacts/roost-pr-37/pr37-clean-ui-2aa050c.tar.gz` and the original private preview download. No existing preview files or data were edited.
- exe.dev documentation confirms the additional-port URL format and private authentication. Local origin checks do not establish authenticated external proxy availability.

Deletion preview handoff was located at the preserved worktree `../roost-delete-agents-preview/PREVIEW-HANDOFF.md` (the assignment's `artifacts/delete-agents-preview/HANDOFF.md` path was absent). It identifies exact PR12 source, isolated schema11 fixture data, and app PID1479306. Read-only inspection only; reset/restart instructions were not executed.

## Verification / final commits

Integration commit `6ce913f6f779296e237cf4f3abd4b032fe76943a`; tested tree `8669a57d7a3b0241fc1048727bd3e2c2bd4a2a0c`. Pushed branch `integration/approved-delete-sections-composer`.

- Definitive committed-tree `pnpm check`: explicit exit0 (`check-committed.exit`), 244/244 repository tests, production auth, app/CLI builds, 6/6 site tests and site builds.
- Focused migration/deletion/navigation/direct-worker regression: 53/53.
- Real rendered desktop/mobile navigation, Threads, production Chat/Jobs/Notes styling, deletion guards/cleanup and PR37 320/390/430/1440 behavior pass. Details and commands in `implementation-handoff.md`.
- Matched changed-copy screenshots in README.md; before is transparently reconstructed original PR12 copy rendered in final production layout, not a historical build. Original historical PR screenshots remain linked in their PRs.
- Actual transport pass: new fixture DB, two durable inputs plus one idempotent retry produced exactly two real Herdr/Codex/Astra submissions and the expected ordered replies. Same terminal identity throughout; second input observed queued while first responded. Managing busy row is synthetic. Herdr did not expose a native session ID for this worker, so native-session continuity is not independently claimed. No replacement launch/stop was permitted by the harness. See `live-exchange-result.json`.
- Initial live harness safely refused the implementation name without the required `roost-` prefix before creating a job or submitting messages. Renamed only this task's new worker to `roost-approved-integrator`; the successful run used that same terminal.

No production code changed after the tested tree. Merge SHAs and final main/tree will be recorded below.


## Final GitHub merges

Normal merges, each guarded with its exact live head and a fresh main check:

| PR | Merged head | Merge SHA |
| --- | --- | --- |
| [36](https://github.com/srctl/roost/pull/36) | `185063234c9870160a76d76cdec0f85ee9de62e1` | `ecbb5b6ea6024f4329724b0d4bc06a28f9d5f516` |
| [37](https://github.com/srctl/roost/pull/37) | `2aa050c1220efe4263e662a77e9a987882c5ef1d` | `03415cbf0035d96048adca070dd44867fdb944b3` |
| [12](https://github.com/srctl/roost/pull/12) | `5fc89672ae61f63a072fcf65da115e444539f8ff` (additive integration) | `820d28226fee5bb91b0c7ba12d5a88d845df2fd0` |

After each of the first two merges, current main was fetched and normally merged into the integration branch. Both resulting trees remained `8669a57d7a3b0241fc1048727bd3e2c2bd4a2a0c`; no changed source required retesting. PR12 received an ordinary fast-forward push, preserving its approved head in ancestry. No force pushes, unrelated PR merges, or direct main pushes.

Final main: **`820d28226fee5bb91b0c7ba12d5a88d845df2fd0`**.
Final tree: **`8669a57d7a3b0241fc1048727bd3e2c2bd4a2a0c`**, byte-for-byte Git tree equality with tested integration `6ce913f6f779296e237cf4f3abd4b032fe76943a`.
All three original approved heads are verified ancestors of final main.
The integration branch was fast-forwarded and pushed to final main.

[Preserved integration branch](https://github.com/srctl/roost/tree/integration/approved-delete-sections-composer).
[Published evidence](https://github.com/srctl/roost/tree/evidence/approved-three-merge).

## Preservation and cleanup

Final read-only HTTP checks returned200 for all five original previews. Listener address/port/PID records are identical before and after: reply4327 PID1173639; sections4336 PID1185471; composer4342 PID1345049; composer4344 PID1353976; deletion4346 PID1479306. Their worktrees/data/workers and original evidence were not modified. No release, deployment, service restart, private/public setting, or other host configuration change occurred.

Removed only task-local copied node_modules, .output, site build outputs, fresh live fixture DB and task temporary test/Codex directories. The tracked worktree is clean. Task evidence remains in `artifacts/approved-three-merge` and the published evidence branch. The prepared worktree remains for coordinator removal after managed completion.

Automatic approval review rejected an attempted close of the newly created implementation child, citing the instruction to keep the managed worker open. The command did not execute; no worker was closed. Both the root managed worker and the idle `roost-approved-integrator` child remain for coordinator handoff. No approval bypass or alternate termination was attempted. This does not block the completed merges.

Remaining verification limits: reconstructed copy baseline rather than an old-head build; Chromium emulation rather than physical mobile/Safari; fresh fixture manager occupancy rather than a live manager model; native session ID not exposed by Herdr; private preview origin availability verified but authenticated external proxy browsing not exercised. Earlier PR37 live occupied-manager evidence and original historical screenshot pairs remain preserved.
