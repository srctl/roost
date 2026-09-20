# Development

This guide covers running Roost from source and contributing to the app. For the
packaged Linux installation, start with [Install and operate Roost](install.md).

## Workspace boundaries

Each JavaScript application owns its package manifest, dependencies, TypeScript
configuration, and build output. `pnpm-workspace.yaml` connects the three apps
and shared packages; `apps/ios` is an Xcode project, not a JavaScript package.
All TypeScript apps extend `@roost/typescript-config/base.json`.

The root `package.json` owns the release version and common commands. `pnpm build`
builds the web/server/CLI bundle; `pnpm build:all` also builds both public sites.
`pnpm check` runs lint, all typechecks and tests, all builds, and the production
authentication and mobile API checks. Native builds require macOS/Xcode and run
separately with `pnpm ios:build`. The [native guide](https://github.com/srctl/roost/blob/main/apps/ios/README.md)
covers simulator tests and regenerating its assets and project.

Root `pnpm dev` and `pnpm start` retain the repository's `.roost` data directory.
An explicit `ROOST_DATA_DIR` must be absolute and takes precedence. Commands run
directly inside `apps/web` otherwise use that directory's local `.roost`.
Run ad hoc TypeScript scripts with `pnpm --filter @roost/web exec node --import tsx ...`
and paths relative to `apps/web` so imports and fixtures resolve in their owning app.

The server and CLI stay in `apps/web`: both rely on the same storage and runtime
modules. Native Swift communicates with the versioned `/api/mobile/v1` HTTP API;
it does not import TypeScript. The iOS project generator reads web character and
theme sources to refresh its checked-in native resources.

## Run from source

Requires Node.js 22.13+ and pnpm 9.15.0 (via Corepack).

```sh
git clone https://github.com/srctl/roost.git
cd roost
corepack pnpm install --frozen-lockfile
corepack pnpm dev     # One development server for the full application
corepack pnpm check   # Lint, formatting, typecheck, regression tests, and build
```

Biome handles linting, import organization, and formatting. Run `pnpm lint`
to check them together, `pnpm lint:fix` to apply safe fixes, or `pnpm format`
to format only. Warnings fail the lint check. The release workflow runs the same
`pnpm check` command.

The configuration starts with Biome's recommended rules and also rejects nested
React component definitions, React prop mutations, and duplicated JSX spreads.
Missing hook dependencies are checked; extra dependencies are allowed for explicit
refreshes and DOM layout updates. Non-null assertions are allowed where the code
knows an invariant TypeScript cannot prove. Other exceptions use local suppressions
with explanations.

Keep a blank line between function definitions, including functions assigned to
variables. Biome preserves these separators but does not enforce their presence.
Generated routes and Codex protocol types, SVG assets, and local agent/browser
directories are excluded. Markdown and YAML are maintained manually; they are no
longer covered by the formatter check.

Composer desktop/mobile interaction checks and matched screenshots are recorded
in [the review evidence](reviews/composer-controls/README.md). Disposable browser
helpers and their fixture are retained only in the historical review revision.

For production:

```sh
corepack pnpm build
HOST=127.0.0.1 corepack pnpm start
```

The Nitro Node adapter emits `apps/web/.output/server/index.mjs` and `apps/web/.output/public`.
`pnpm start` runs one Node server that handles requests and serves the UI assets.
Set `PORT` and `HOST` to configure the production listener. Keep it on loopback
for local use. For remote access, configure [native passkey login](authentication.md)
with HTTPS, or use an SSH tunnel or an authenticated proxy. Roost is a single-user
application; native login is opt-in.

Source builds use a separately installed Codex CLI. Open **Settings → Account & security → Connect Codex** after starting the app, or use the terminal login described in the
[installation guide](install.md#connect-codex). Set `ROOST_CODEX_BINARY` to use a
specific executable:

```sh
ROOST_CODEX_BINARY=/path/to/codex corepack pnpm dev
```

The model list comes from that executable and the connected account. Different
Codex versions can expose different models.

See [Message threads](message-threads.md#verification) for the isolated desktop/mobile
browser regression harness.

## Public websites

The marketing and documentation sites live in `apps/marketing` and `apps/docs`.
They build separately from the app. See [Public websites](public-sites.md) for
local previews, public addresses, build commands, and hosting setup.

## Components and styling

Base UI means `@base-ui/react`. The button is adapted from
[shadcn/ui's Base UI registry](https://ui.shadcn.com/r/styles/base-nova/button.json)
and styled with StyleX. New components are locally owned source: adapt shadcn's
Base UI components and translate their styles to StyleX. Stock `shadcn add` is
not configured because it assumes Tailwind.

The StyleX Vite plugin runs before React and compiles styles for the client and
server builds. The root route links the emitted stylesheet so the server-rendered
page is styled before hydration.

Motion follows shared tokens in `apps/web/src/styles/motion.stylex.ts`: three durations
(`fast`, `base`, `slow`) and three easings. The durations collapse to zero under
`prefers-reduced-motion`, so any transition or animation that reads them honours
that setting without its own media query. Entrance animations only play for
changes the visitor caused: `useMountedAfterLoad` gates elements that mount after
the first client render, `useLiveEntries` marks conversation entries appended
after the history was first shown, and `useOpenAfterMount` lets lazily loaded
Base UI popups mount closed so their open transition runs. Server-rendered markup
never replays an entrance at startup.

React Compiler is enabled for client components and hooks through Vite's
`reactCompilerPreset`. It runs before StyleX and framework transforms and uses
React 19's built-in compiler runtime. Components the compiler cannot safely
optimize keep their existing behavior. Existing `useMemo` and `useCallback` calls
can stay in place.

## Build and publish releases

Choose the exact version being released in place of `X.Y.Z`.

```sh
corepack pnpm check
ROOST_VERSION=X.Y.Z ROOST_REPOSITORY=srctl/roost corepack pnpm release:pack
```

Packaging produces `dist/roost-linux-x64.tar.gz`, `SHA256SUMS`, and `install.sh`.
The archive includes application assets, the CLI, pinned runtimes, and license
notices. It excludes `.roost`, source credentials, and the development checkout.
Runtime URLs and trusted checksums are checked into `scripts/runtime-versions.json`.
To change a runtime, verify its official release checksum and update that file.
Set `ROOST_RUNTIME_CACHE` if you want a persistent download cache; a mismatched
cached archive is rejected.

The release workflow runs checks and packaging for a pushed `vX.Y.Z` tag,
creates a draft release, uploads all assets, then publishes it. Enable GitHub's
immutable releases setting on the repository to prevent later replacement.
Roost is distributed under the MIT license. Publishing is triggered by pushing a
release tag; local builds do not publish a release.

## Further reading

See [Architecture](architecture.md) for source layout, the Codex protocol, and
storage boundaries; [Conversation performance](chat-performance.md) and
[PWA startup](pwa-startup.md) record measured behavior and remaining limits.
