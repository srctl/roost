# Juxi JavaScript snapshot

`juxi-0.0.0.tgz` was packed with `npm pack --ignore-scripts` from the user's Juxi
working source on 2026-09-19. That source was not yet a Git repository or published
npm release. It contains the compiled library, declarations, source maps, README,
and package metadata; it does not include `.env`, credentials, or node_modules.

SHA-256: `59074b61e5d94aa897f37eeb66e594b5af66f0e824ab85a5b80c10932e7f4bfc`

The pnpm lockfile also pins its integrity. This is an interim reproducible dependency
until the upstream builder completes GitHub/npm publication; replace the file
dependency with that verified exact version and remove this snapshot together.
