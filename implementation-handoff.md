Local cumulative integration is committed on `integration/approved-delete-sections-composer`.

- PR36 local merge: `8f1cb5b1e102a8b5e2aa383be8ee5e22ae3fffcb`.
- PR37 local merge: `89720544a595a1933d58f0bb6987b4dfa2d96f01`.
- PR12 merge + cumulative fixes: `6ce913f6f779296e237cf4f3abd4b032fe76943a`.
- Final source tree: `8669a57d7a3b0241fc1048727bd3e2c2bd4a2a0c`.
- All three exact approved heads are ancestors. PR12 is the final merge's second parent, so coordinator can update PR12 additively after PR36/37 merge. No rebasing or force updates.

Deletion now removes and fences the newer Notes/history, conversation/session/provider mapping, job workspace/feedback, worker message/fence and navigation membership records. Shared navigation sections, profiles, native thread metadata and all disk files remain retained. Runtime disposal stays required. Queued/dispatching inputs, unacknowledged uncertain direct submissions, incomplete deliveries/responses and worker fences block deletion even for completed/cancelled jobs. A stale worker observation cannot resurrect records after deletion.

Core remains 14. Deletion uses its own version table; PR12 deletion-only v11 tombstones are conservatively recognized. Existing Notes/Threads shape checks remain, and malformed/future deletion schemas roll back without modifying storage. PR36's default unheaded list, stable IDs/routes/drafts and PR37's existing same-worker ordered queue remain intact. The root reset stylesheet's StyleX injection fix was already present and is preserved.

Validation commands (run from this worktree):

```sh
python3 /tmp/approved-three-run.py pnpm check
python3 /tmp/approved-three-run.py node --import tsx --test --test-isolation=none --test-reporter=tap tests/delete-agents.test.ts tests/schema-upgrades.test.ts tests/agent-navigation.test.ts tests/coding-worker-conversation.test.ts
python3 /tmp/approved-three-run.py node --import tsx tests/browser/approved-integration.ts
python3 /tmp/approved-three-run.py node --import tsx tests/browser/agent-navigation.ts
python3 /tmp/approved-three-run.py node --import tsx tests/browser/threads.ts
python3 /tmp/approved-three-run.py node --import tsx artifacts/approved-three-merge/capture-copy-comparison.ts
python3 /tmp/approved-three-run.py pnpm lint
python3 /tmp/approved-three-run.py pnpm typecheck
```

`clean-test-environment.py` preserves the launcher for reproducibility. It strips inherited Roost/Nitro/Codex/Herdr overrides and HOST/PORT, sets umask022, creates fresh isolated data/Codex directories, and supplies the Chrome executable. **ROOST_CODEX_BINARY remains unset for the suite**; browser fixtures explicitly set their fake binary in child environments. Tests needing loopback listeners/browser processes used approved execution outside the restricted sandbox. Dependencies were copied locally from an identical lockfile; no shared dependency caches or preview worktrees were modified.

Results:

- Focused regressions: 53/53, exit0 (`focused-final.log`).
- Production integration: fresh-context Chat, Jobs and Notes at 1440×1000 and 390×844 have root StyleX CSS and no horizontal overflow or page exceptions. Browser deletion refuses active and terminal-but-queued workers, then deletes only the isolated fixture after settlement. Exit0 (`browser-copy-final.log`, also `browser-integration.log`).
- PR37 browser suite: 320, 390, 430 and 1440 widths; composer prominence, long drafts, focus, reload, history, alternate conversation navigation, short viewport and synthetic visual viewport checks. All pass. Physical keyboard behavior is not verified.
- PR36 browser suite: desktop/mobile rename/sections, lost-response retries, stable routes/drafts, plain default list, and compiled mutation auth checks pass, exit0 (`browser-navigation.log`).
- Thread suite: Codex/Messages layouts at four viewport/touch combinations, then desktop/mobile thread drafts, attachments, focus, scroll anchors, unread, runtime retrieval and queue/cancel pass, exit0 (`browser-threads.log`).
- Final lint/typecheck pass, exit0. Lint retains one pre-existing informational template-literal suggestion, not a warning/error.
- Full check on frozen production source completed all 244 unit tests, production auth, app/CLI build, and 6 site tests/site builds (`full-check-final.log`). Its tool session reported143 despite complete output. The definitive committed-tree rerun passed with explicit shell exit **0** in `check-committed.exit`: 244/244 unit tests, production auth, app/CLI build, 6/6 site tests and both site builds (`check-committed.log`).

Visual evidence is untracked and locally excluded. `implementation-evidence-manifest.json` identifies screenshot/log hashes. Matched copy pairs: `desktop-delete-copy-{before,after}.png`, `mobile-delete-copy-{before,after}.png`. Before renders exact PR12 paragraph copy via DOM text substitution on the final production fixture; after restores final source text. Same styles, state, viewport, reduced motion. This is explicitly a reconstructed rendered copy baseline, **not a separate old-head build**. Per-viewport comparison JSON records source and text. All final screenshot pairs were visually inspected.

Preliminary diagnostic limitations were resolved: restricted networking prevented fixture listeners; an invalid old neighboring-approval fixture lacked its originating run; the initial launcher mistakenly set ROOST_CODEX_BINARY and upset existing Herdr command mocks. Logs are retained for transparency. The final production code does not work around these test environment issues.

No real agent deletion, GitHub push/merge, release/deploy/host operation, Roost/Notion update, extra agent, or existing preview/data/worker modification was performed. Real same-worker transport is deliberately left to coordinator's post-handoff harness. This implementation worker/pane remains open.
