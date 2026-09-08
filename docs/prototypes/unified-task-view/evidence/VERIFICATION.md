# Verification record

Date: 2026-09-08. Base: `3f7bae2`. Branch: `research/unified-task-view`.
All new tracked files are under `docs/prototypes/unified-task-view/`.

| Exact command (from repo root) | Result | Log |
| --- | --- | --- |
| `node node_modules/@biomejs/biome/bin/biome check --error-on-warnings .` | PASS, exit 0; repository-wide lint/format | [lint.log](lint.log) |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS, exit 0 | [typecheck-app.log](typecheck-app.log) |
| `node node_modules/typescript/bin/tsc --project docs/prototypes/unified-task-view/tsconfig.json` | PASS, exit 0 | [typecheck-prototype.log](typecheck-prototype.log) |
| `node node_modules/vite/bin/vite.js build --config docs/prototypes/unified-task-view/vite.config.mjs` | PASS, exit 0; isolated build only in `/tmp/unified-task-view-build` | [build.log](build.log) |
| `node docs/prototypes/unified-task-view/generate-designs.mjs` | PASS; six native scenes generated | Native files in `../designs/` |
| `PLAYWRIGHT_MODULE=/tmp/unified-task-tools/node_modules/playwright/index.mjs CHROME_PATH=/usr/bin/google-chrome CHROME_NO_SANDBOX=1 node docs/prototypes/unified-task-view/capture.mjs --before` | PASS, exit 0; baseline captured before unified implementation | [before.log](before.log) |
| `PLAYWRIGHT_MODULE=/tmp/unified-task-tools/node_modules/playwright/index.mjs CHROME_PATH=/usr/bin/google-chrome CHROME_NO_SANDBOX=1 node docs/prototypes/unified-task-view/capture.mjs` | PASS, exit 0; desktop + mobile | [after.log](after.log) |
| `PLAYWRIGHT_MODULE=/tmp/unified-task-tools/node_modules/playwright/index.mjs CHROME_PATH=/usr/bin/google-chrome CHROME_NO_SANDBOX=1 node docs/prototypes/unified-task-view/verify-designs.mjs` | PASS, exit 0; all six native files load in real Excalidraw 0.18.0; element counts and native text preserved through serialization; SVG and rendered PNG exports | [design-validation.log](design-validation.log) |

Prototype browser assertions: blocked-task drilldown is a simulated destination only; stale GitHub changes checks to current unknown; Human review remains distinct from Done; attention filter finds two tasks; empty/title search; missing PR disables its destination; verified handoff releases exactly one slot and prevents a second handoff; fixture reset; B/C layout navigation; mobile Back preserves filter; no horizontal page overflow, external/API requests or page exceptions. Capture waits for selected task content before the initial after screenshot.

Excalidraw validation uses its file input and `loadFromBlob`, verifies 23/38 elements for A desktop/mobile, 32/35 for B, 21/35 for C, serializes with `serializeAsJSON`, and exports via `exportToSvg`. It checks every native text value, not just JSON syntax. A second browser page renders each exported SVG into a PNG. Editor screenshots are separate from application screenshot evidence. This validates load/round-trip/export, not every possible Excalidraw editing operation.

Screenshot metadata and SHA-256 values are in [captures.json](captures.json). Application viewport pairs are 1440×1100 and 390×844, device scale 1, light mode, UTC. Full-page output height varies. Same blocked assignment is selected in both before/after; fixtures are shared with the baseline's three current jobs. Two source-only/historical tasks appear only in the proposed unified list. The baseline replaces the app shell and stubs router/server boundaries, as explained in the main README.

Visual inspection covered the before/after desktop/mobile captures, desktop option wireframes and the mobile list/detail composition. It found and corrected an initially premature blank desktop capture and an overlong mobile overview before detail. Only the corrected after files are retained. A first lint pass found ARIA/autofocus and CSS specificity issues; these were corrected before the final clean pass.

Environment/setup notes:

- Existing installed Codex/Herdr assignment context was retained; no worker/model override, host configuration or provisioning change.
- This checkout initially lacked `node_modules` and `pnpm` on PATH. A temporary pnpm 9.15.0 was installed under `/tmp/unified-task-tools`, then `/tmp/unified-task-tools/node_modules/.bin/pnpm install --frozen-lockfile --store-dir /tmp/unified-task-pnpm-store` succeeded. Original install log remains `/tmp/unified-task-install.log`. Root package and lockfile are unchanged.
- Temporary tooling: Playwright 1.63.0, Excalidraw 0.18.0, Google Chrome 152.0.7977.82, Node v24.15.0. `npm install --prefix /tmp/unified-task-tools --no-audit --no-fund playwright @excalidraw/excalidraw@0.18.0`; npm emitted deprecation/peer-resolution notices, with successful install. No project dependency change.
- Restricted execution initially rejected binding loopback (`EPERM`); authorized escalated fixture servers succeeded. Port 4183 was occupied, so the editor uses 4283 without touching the occupying process. Prototype port is 4182. Exact server commands are in the README; logs: [vite.log](vite.log), [editor-server.log](editor-server.log).
- Initial GitHub PR read was network-restricted; the approved `gh pr view 4 --repo srctl/roost --json title,body,files,url` succeeded. Only the explicitly allowed prior research directory was read locally.

Not run: full application regression suite, app/CLI production builds, production auth tests, live Notion/GitHub integration, real worker monitoring, synchronization, user study, screen-reader audit, load/performance, dark mode, or actual approval/merge/Done actions. Those are outside this isolated research change. No new automated-test framework was added; the two small scripts directly validate the required prototype and artifact acceptance criteria.
