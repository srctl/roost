# Jexo against the Roost web UI

Three initial journeys exercise the real built Roost app:

- Cancel a display-name edit and reopen it with the original name.
- Reject a whitespace-only name with a visible validation error.
- Save a trimmed name, return to the conversation, and prove persistence after reload.

Tests use Jexo's documented `test(name, (ai, config) => ...)` declarations:
`config.start`, `config.inputs`, `config.limits`, `ai.goal`, `ai.step`, and
`ai.verify.code`. Jev chooses UI actions and independently judges the ordered
steps. End-state checks remain deterministic Playwright assertions; a model
cannot waive them. There are no approved path baselines yet.

**The default run uses real Jev calls.** It requires `TYPESAFE_API_KEY` and may
incur TypeSafe charges. Missing credentials fail explicitly; the suite never
silently substitutes a scripted chooser.

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

## Jev execution and diagnostic mode

Supply your existing TypeSafe key securely in the environment. Do not put it
in source, command arguments, or evidence. If it is saved in
`~/.config/jt/typesafe.env`, Node can load it without displaying it:

```sh
corepack pnpm --filter @roost/web exec node --env-file="$HOME/.config/jt/typesafe.env" --import tsx tests/jexo/run.ts
```

This sends synthetic fixture page text, legal action labels, test inputs, and
observed action history to TypeSafe. Screenshots stay local. The SDK uses
`jev-latest` unless `TYPESAFE_DEFAULT_MODEL` is set; the responding model is
recorded. No fallback is configured.

This runs exactly these three tests, at most 10 UI actions and 60 seconds per
test. A direct run is expected to use 17 actor decisions and 14 step-verification
calls. The configured bound is 30 actor decisions plus at most 14 verifications;
with one retry per call, at most 88 HTTP attempts. There is no enforced dollar
cap. Usage/cost estimates are recorded in each run. Live success is unverified
until actual Jev run evidence exists.

An explicit diagnostic mode is available for testing the harness without any
model calls:

```sh
corepack pnpm --filter @roost/web exec node --import tsx tests/jexo/run.ts --offline
```

It uses a scripted chooser and a separate verifier that matches declared steps
against the observed action journal after each preceding checkpoint. It proves
runner integration and app behavior, **not Jev accuracy**. Jexo labels `ai.step`
entries as model-judged because of their declaration form; offline verification
messages and timeline metadata explicitly identify the scripted verifier.
Offline runs correctly report zero Jev calls and zero cost.

## Integration constraints found

- This development harness imports Jexo's internal runner, discovery, and
  chooser/verifier APIs, so a Jexo refactor may require an adapter update. Public package
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
