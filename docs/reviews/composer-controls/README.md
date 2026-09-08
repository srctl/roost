# Composer controls verification

Verified on 2026-09-08 in `feat/composer-controls`, based on `3f7bae2`.

## Behavior

During a running turn, non-whitespace message text shows only Send. Clearing the
draft, or successfully sending it, restores Stop if the turn is still running.
Whitespace uses the existing `trim()` semantics. Attachment-only drafts retain
both Send and Stop. Idle behavior, upload/loading/submission guards, failed-send
draft retention, and edits made while sending are preserved.

At widths up to 700px, Send and Stop have 36px visible circles inside 44px touch
targets. Desktop remains 28px. Accessible names and native keyboard activation
remain intact.

## Results and commands

This VM did not have pnpm/Corepack on PATH. The commands below used pnpm 9.15.0 at
`/tmp/roost-composer-tools/node_modules/.bin/pnpm`; on a normal development setup,
substitute `pnpm`. Dependencies were installed with `install --frozen-lockfile`,
then Playwright 1.58.2 was added as a pinned development dependency.

### Full suite: PASS, 138 tests, 0 failures

```sh
umask 022
env -u ROOST_CODEX_BINARY -u NITRO_PORT -u NITRO_HOST /tmp/roost-composer-tools/node_modules/.bin/pnpm test
```

Ran in a dedicated test shell with loopback access. The umask and environment
removals apply only to this process, with no host configuration changes. The
suite includes backend follow-up/attachment steering and cancellation tests.

The initial run had 132 passes and six failures: five Herdr mock failures with
inherited `ROOST_CODEX_BINARY`, plus a packaging executable-mode mismatch under
umask `0077`. All passed after the test environment correction above; no unrelated
source or tests were modified.

### Production auth: PASS

```sh
umask 022
env -u NITRO_PORT -u NITRO_HOST /tmp/roost-composer-tools/node_modules/.bin/pnpm test:auth:production
```

Output: `Production auth smoke passed: enrollment, login, private pages/API,
desktop upgrade, revocation, and recovery.`

The earlier run with inherited Nitro host/port overrides stalled and was
interrupted. Removing those overrides let the existing test use its isolated
server and temporary data successfully.

### Composer browser regression: PASS in all three modes

```sh
COMPOSER_CHROME_PATH=/usr/bin/google-chrome COMPOSER_ARTIFACTS=/tmp/roost-composer-artifacts /tmp/roost-composer-tools/node_modules/.bin/pnpm test:composer
```

The isolated Vite fixture uses actual Composer/Button components, local send/stop
callback doubles, and mocked uploads. It starts no Roost worker and uses a
separate headless Chrome profile, without accessing the shared desktop.

Desktop, mobile touch, and standalone JavaScript emulation each passed:

- Text/empty/whitespace visibility transitions and draft clearing after success.
- Click/tap and Enter submission, trimmed payloads, duplicate-send prevention,
  failed-send retention, and preservation of edits made during pending sends.
- Keyboard Stop activation on desktop and outer-rim taps on mobile; idle sending
  and Shift+Enter newline behavior.
- Loading/upload guards, attachment-only control visibility, attachment payloads,
  and attachment clearing after success.
- Measured 44px mobile targets with 4px transparent borders and 28px desktop
  controls; no browser page errors.

### Lint, typechecking, build: PASS

```sh
/tmp/roost-composer-tools/node_modules/.bin/pnpm lint
/tmp/roost-composer-tools/node_modules/.bin/pnpm typecheck
/tmp/roost-composer-tools/node_modules/.bin/pnpm build
node_modules/.bin/biome check --error-on-warnings scripts/test-composer.ts tests/fixtures/composer
node_modules/.bin/tsc --ignoreConfig --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --jsx react-jsx --strict --skipLibCheck --types vite/client,node scripts/test-composer.ts tests/fixtures/composer/main.tsx
git diff --check
```

The extra TypeScript command covers the browser test and fixture outside the app
TSConfig. Client/server and CLI builds succeeded. Vite emitted an existing
extensionless-config-import warning and plugin timing notices.

## Screenshots

Screenshots from the passing component fixture are retained beside this file.
They show the component in isolation; the surrounding page is not the full app.

| Mode | Send | Stop |
| --- | --- | --- |
| Desktop | [Send](desktop-Send.png) | [Stop](desktop-Stop.png) |
| Mobile | [Send](mobile-Send.png) | [Stop](mobile-Stop.png) |
| Standalone JS emulation | [Send](standalone-Send.png) | [Stop](standalone-Stop.png) |

## Limits

No live agent or production conversation was used. Standalone checks emulate the
JavaScript `matchMedia` branch on a mobile viewport; they do not represent a
physical installed iOS PWA. Native keyboard animation, installed status-bar
behavior, and physical iOS verification remain untested.
