# Jexo against the Roost web UI

Three initial journeys exercise the real built Roost app:

- Cancel a display-name edit and reopen it with the original name.
- Reject a whitespace-only name with a visible validation error.
- Save a trimmed name, return to the conversation, and prove persistence after reload.

Every test has ordered, exact action matchers and deterministic Playwright code
assertions. There are no fuzzy assertions or approved path baselines yet.
The free mode uses Jexo's real runner, legal action snapshots, enforcement,
verdicts, screenshots, and evidence writer with a scripted chooser. It proves
integration and app behavior, **not Jev's semantic accuracy**.

## Local setup

Jexo is private and unpublished. Do not fetch `jexo` from npm. Build the local
checkout and link it only inside this test directory (the root pnpm lockfile is
unchanged). Bun must be on PATH. Node 22.18+ is recommended; the harness uses
Roost's existing tsx loader.

```sh
# In the Jexo checkout, currently named jt on this Mac:
bun run build

# In Roost:
corepack pnpm build
mkdir -p apps/web/tests/jexo/node_modules
ln -s /absolute/path/to/jt apps/web/tests/jexo/node_modules/jexo
export JEXO_CHECKOUT=/absolute/path/to/jt
corepack pnpm --filter @roost/web exec node --import tsx tests/jexo/run.ts
corepack pnpm --filter @roost/web exec tsc --noEmit -p tests/jexo/tsconfig.json
```

If Roost's Playwright browser is missing, set `ROOST_TEST_CHROME` to an installed
Chromium executable. This Mac already has:

```sh
export ROOST_TEST_CHROME="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell"
```

Use `--headed` to see the local Chromium window. The runner always launches its
own loopback server on a random port with a new temporary data directory and
fake Codex executable. It does not accept an existing server URL. The server
gets a small environment containing no real model credentials. Feed remains
disabled, no chat is sent, and browser requests outside the fixture origin are
blocked. Each test uses a separate agent and browser context. The server,
browser, and temporary data are cleaned up after execution.

Evidence goes to `apps/web/output/playwright/jexo/`, including `summary.json`
and each run's `run.json`, action screenshots, and final screenshot. Set
`ROOST_JEXO_RUNS` for a different evidence directory. Keep evidence out of Git;
these fixtures contain synthetic names only. Failed runs are retained.

## Optional live Jev evaluation

Obtain permission for paid execution before running this command. Supply a
TypeSafe key securely in the environment; never include it in source or a
command argument. This mode sends synthetic page text and test inputs to
TypeSafe. It is opt-in through **both** `ROOST_JEXO_LIVE=1` and `--live`:

```sh
ROOST_JEXO_LIVE=1 corepack pnpm --filter @roost/web exec node --import tsx tests/jexo/run.ts --live
```

This runs exactly these three tests, with no fallback, at most 10 actions and
60 seconds per test. No live Jev run has been verified yet. The runner records
usage/cost estimates; it does not enforce a dollar spending cap. Ask for a
three-test run with these limits, rather than open-ended model evaluation.

## Integration constraints found

- This development harness imports Jexo's internal runner, discovery, and
  chooser APIs, so a Jexo refactor may require an adapter update. Public package
  exports currently expose authoring and types, but no offline runner hook.
- Roost's tsx loader injects a helper into Jexo's functions passed to
  `page.evaluate`. The harness bundles the runner with Bun into ignored
  `.runner/` first, matching Jexo's own build approach.
- SSR controls can appear before hydration. The adapter waits for React's
  initial client attachment. In free mode it also waits for known asynchronous
  fixture transitions before the next snapshot. Live mode gets the hydration
  wait only; it must choose its route independently. Jexo itself currently
  waits for document load rather than general SPA transition completion.
- Jexo models native `dialog:modal` scope. Roost uses Base UI sheets with ARIA
  dialogs, so these tests do not claim native modal-boundary enforcement.
- Jexo supports clicks, checkboxes, and input/textarea fills. Rich-text note
  editing, uploads, keyboard shortcuts, and drag interactions need additional
  runner support or separate conventional Playwright coverage.
