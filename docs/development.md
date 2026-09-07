# Development

This guide covers running Roost from source and contributing to the app. For the
packaged Linux installation, start with [Install and operate Roost](install.md).

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

For production:

```sh
corepack pnpm build
HOST=127.0.0.1 corepack pnpm start
```

The Nitro Node adapter emits `.output/server/index.mjs` and `.output/public`.
`pnpm start` runs one Node server that handles requests and serves the UI assets.
Set `PORT` and `HOST` to configure the production listener. This is currently a
local, single-user application without application-level authentication. Keep the
listener on loopback.

Source builds use a separately installed Codex CLI. Open **Settings → Connect
Codex** after starting the app, or use the terminal login described in the
[installation guide](install.md#connect-codex). Set `ROOST_CODEX_BINARY` to use a
specific executable:

```sh
ROOST_CODEX_BINARY=/path/to/codex corepack pnpm dev
```

The model list comes from that executable and the connected account. Different
Codex versions can expose different models.

## Public websites

The marketing and documentation sites live in `sites/marketing` and `sites/docs`.
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

Motion follows shared tokens in `src/styles/motion.stylex.ts`: three durations
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
