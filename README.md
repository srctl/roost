# Roost

A home for persistent AI agents and their work. Roost is intended to be
self-hostable, with each agent owning its conversations, tasks, schedules,
and approvals.

This repository is **scaffolding only**. The web page is static, its button is
disabled, and the backend prints a message and exits. There are no API routes,
agent runs, storage, authentication, schedules, or external connections yet.

## Development

Requires Node.js 22.12+ and pnpm 9.15.0 (via Corepack).

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev          # Static web shell
corepack pnpm dev:server   # Backend entry point in watch mode
corepack pnpm check        # Typecheck, formatting, and production builds
```

`pnpm build` writes `dist/web` and `dist/server`. `pnpm start:server` runs the
compiled backend placeholder and exits; it does not start an HTTP server.

## Pieces in place

- `src/web`: React, Vite, and TypeScript.
- `src/web/styles`: StyleX tokens and a small global CSS reset.
- `src/web/components/ui`: locally owned shadcn/Base UI components.
- `src/server`: TypeScript with Effect and the Node runtime.
- `src/server/codex`: the disconnected Codex app-server adapter boundary.

Keep external interactions and backend behavior in Effect programs. React owns
rendering; future UI interactions should invoke Effect programs at the boundary.
There are no interaction handlers to wire up in this scaffold.

## Component convention

“Base UI” means `@base-ui/react`. The initial button is adapted from
[shadcn/ui's Base UI registry](https://ui.shadcn.com/r/styles/base-nova/button.json),
with its styling rewritten in StyleX. Only its default appearance is included.

[shadcn's stock setup](https://ui.shadcn.com/docs/installation/manual) uses
Tailwind. This repo deliberately uses StyleX instead, so it does not include
Tailwind or a misleading `components.json`. Add component source locally and
translate the styles to StyleX; `shadcn add` is not configured for direct use.

## Codex boundary

The backend will own the
[Codex app-server connection](https://developers.openai.com/codex/app-server/).
The intended initial transport is stdio, with initialization followed by
thread/turn requests and streamed events. The adapter currently returns a typed
`CodexNotConnected` failure and is not called by the entry point.

When implementing that connection, generate protocol types from the chosen
Codex CLI version with `codex app-server generate-ts --out <directory>`.
No Codex CLI, credentials, or API key is required to run this scaffold.

The [StyleX Vite setup](https://stylexjs.com/docs/learn/installation/vite/vite-react)
compiles styles at build time using `@stylexjs/unplugin`.
