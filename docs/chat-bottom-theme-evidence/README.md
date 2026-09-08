# Return-to-bottom button with custom themes

PR7 is stacked on [custom themes PR2](https://github.com/srctl/roost/pull/2).
The theme branch was merged normally into the existing button history; neither
source branch history was rewritten. The button already inherits palette tokens
for its foreground, translucent surface, border and hover. This follow-up adds a
2px `:focus-visible` outline using the foreground token. Mobile Chromium's native
amber outline measured approximately 2:1 in Default light; an explicit palette
color keeps keyboard focus readable across appearances.

## Matched rendered evidence

BEFORE is theme-only commit `0c7652fc8a7e54c8abf2ad050a57d7e9ae6e74e9`,
archived and built separately in `/tmp`. AFTER is the stacked implementation with
the explicit focus ring. These are actual Chromium production-build screenshots,
not mockups. Each pair uses identical fictional Moss/Wisp conversations, route,
empty composer, unfocused state, device scale factor 1, light device appearance,
explicit saved palette/mode, reduced motion, viewport and scroll metrics.
Desktop is 1440×1000; mobile is 390×844 with touch/mobile emulation.
[Capture metadata](capture-metadata.json) records every pair's scroll geometry.
Only isolated fixture storage and localhost previews were used; no live Roost
storage/configuration or other worktrees were modified.

| Palette / appearance | Desktop BEFORE | Desktop AFTER | Mobile BEFORE | Mobile AFTER |
| --- | --- | --- | --- | --- |
| Default light | [BEFORE](before-desktop-default-light.png) | [AFTER](after-desktop-default-light.png) | [BEFORE](before-mobile-default-light.png) | [AFTER](after-mobile-default-light.png) |
| Default dark | [BEFORE](before-desktop-default-dark.png) | [AFTER](after-desktop-default-dark.png) | [BEFORE](before-mobile-default-dark.png) | [AFTER](after-mobile-default-dark.png) |
| Rosé Pine light | [BEFORE](before-desktop-rose-pine-light.png) | [AFTER](after-desktop-rose-pine-light.png) | [BEFORE](before-mobile-rose-pine-light.png) | [AFTER](after-mobile-rose-pine-light.png) |
| Rosé Pine dark | [BEFORE](before-desktop-rose-pine-dark.png) | [AFTER](after-desktop-rose-pine-dark.png) | [BEFORE](before-mobile-rose-pine-dark.png) | [AFTER](after-mobile-rose-pine-dark.png) |
| Carbonfox light | [BEFORE](before-desktop-carbonfox-light.png) | [AFTER](after-desktop-carbonfox-light.png) | [BEFORE](before-mobile-carbonfox-light.png) | [AFTER](after-mobile-carbonfox-light.png) |
| Carbonfox dark | [BEFORE](before-desktop-carbonfox-dark.png) | [AFTER](after-desktop-carbonfox-dark.png) | [BEFORE](before-mobile-carbonfox-dark.png) | [AFTER](after-mobile-carbonfox-dark.png) |
| Catppuccin light | [BEFORE](before-desktop-catppuccin-light.png) | [AFTER](after-desktop-catppuccin-light.png) | [BEFORE](before-mobile-catppuccin-light.png) | [AFTER](after-mobile-catppuccin-light.png) |
| Catppuccin dark | [BEFORE](before-desktop-catppuccin-dark.png) | [AFTER](after-desktop-catppuccin-dark.png) | [BEFORE](before-mobile-catppuccin-dark.png) | [AFTER](after-mobile-catppuccin-dark.png) |

Keyboard focus examples: [desktop](focus-desktop-catppuccin-light.png),
[mobile](focus-mobile-catppuccin-light.png).

## Verification

- `pnpm check` passed on the final source: lint, typecheck, 140 regression
  tests, application/CLI production builds, production auth smoke, six docs-site
  tests, site typecheck and both site builds. The process used umask `022` and
  removed inherited `ROOST_*`, `NITRO_*`, `CODEX_*` and `HERDR_*` variables, as
  required by the existing isolated fixtures.
- `node .roost/chat-bottom-themes/matrix.mjs after` plus
  `python3 .roost/chat-bottom-themes/contrast.py`: 48 browser states passed
  (four palettes × three saved modes × two device appearances × two viewports).
  Verified exact foreground/surface/border/hover palette values, 88% surface
  opacity, visible 2px focus outline, icon and focus contrast, half-viewport
  threshold boundaries, Enter/Space/click/tap, focus transfer, 44px targets,
  composer clearance, no horizontal overflow and no page errors. System changes
  resolve to the matching explicit palette; explicit modes ignore device changes.
- `node .roost/chat-bottom-themes/capture.mjs`: all 16 BEFORE/AFTER pairs
  passed exact scroll geometry comparisons on the final build.
- The existing `scripts/test-themes-browser.mjs` passed on the integrated build.
  Its final-build navigation assertion initially raced SPA route completion;
  a disposable copy, `.roost/chat-bottom-themes/settings.mjs`, waits for the
  destination URL and preview cleanup before asserting. That copy passed all
  16 palette views, eight sample conversation views, preview/cancel/save/reload,
  navigation cleanup, System changes, keyboard selection, blocked storage,
  SSR first paint and absence of browser errors. No production theme behavior or
  checked-in theme test was changed for this timing issue.
- `node .roost/chat-bottom-themes/interactions.mjs`: all 24 scenarios passed
  (four palettes × three saved modes × desktop/mobile). Verified threshold,
  Enter/Space/click, focus transfer, streamed edits preserving manual position,
  follow resumption after activation, immediate manual scrolling, older-history
  anchoring, switching to a short thread and back, composer growth, light/dark
  switching, no overflow and no browser errors. Desktop used normal motion;
  mobile used reduced motion. The long combined invocation was terminated after
  all 24 scenarios reported success, before the appended-message command began.
  `TEST_PRESET=catppuccin TEST_MODE=system node
  .roost/chat-bottom-themes/interactions.mjs` then repeated the final pair and
  exited successfully; the remaining checks ran in the shorter invocation.
- `node .roost/chat-bottom-themes/new-messages-all.mjs`: all 12 touch/mobile
  scenarios passed (four palettes × three saved modes). Newly appended replies
  crossed the visibility threshold without a scroll event while preserving
  the reader's position; tapping jumped to the bottom; subsequent replies
  followed automatically; resizing the viewport recalculated visibility.
- `git diff --check` passed.

Disposable scripts, fixture database and complete logs remain uncommitted in
`.roost/chat-bottom-themes/` for coordinator review. They run solely against
localhost ports 3297/3298. Browser tooling was reused from `/tmp`; dependency
installation used the frozen lockfile and an existing offline store.

### Measured button contrast

Normal contrast composites the translucent surface over the page background.
Focus is the minimum against page, composited button and hover surface.
The arrow exceeds 4.5:1 and the focus ring exceeds 3:1 in all 48 states.
The token-based border was also checked but is decorative (1.20–2.30:1).

| Palette / appearance | Arrow normal | Arrow hover | Focus minimum |
| --- | --- | --- | --- |
| default/light | 14.09:1 | 11.92:1 | 11.92:1 |
| default/dark | 13.30:1 | 9.65:1 | 9.65:1 |
| rose-pine/light | 6.96:1 | 5.25:1 | 5.25:1 |
| rose-pine/dark | 12.34:1 | 7.93:1 | 7.93:1 |
| carbonfox/light | 17.89:1 | 13.79:1 | 13.79:1 |
| carbonfox/dark | 15.00:1 | 10.49:1 | 10.49:1 |
| catppuccin/light | 7.87:1 | 5.17:1 | 5.17:1 |
| catppuccin/dark | 10.62:1 | 6.31:1 | 6.31:1 |

## Limitations

Chromium desktop and emulated mobile were tested. Physical mobile keyboards,
iOS/Safari, Firefox and installed-PWA behavior were not tested. The border is a
subtle decorative surface edge; the arrow and focus indicator provide the strong
contrast. This is scoped compatibility verification, not a whole-app accessibility
audit. No deployment or GitHub PR merge was performed.
