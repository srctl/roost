# Dashboard chart review evidence

Actual Chrome renders from isolated production builds. No running Roost storage,
settings, agents, or configuration were used. Baseline commit:
`3f7bae287253e1c4c5449ea78521b2fcc072152d`.

The paired captures use the same `/agents/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/dashboard`
route, “Project insights” agent, single “Delivery overview” widget, metrics
(42 completed, 8 in progress), four weekly values (6, 9, 12, 15), and fixed
2026-09-08 12:00 UTC update time. Both are at the top of the dashboard with
navigation/chat in their default desktop/mobile states, light appearance,
device scale 1, and reduced motion. The after fixture expresses the same chart
as a reference to one saved dataset. The data catalog and Fluent plot are new.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop, 1440 × 1100 | [Before](before-desktop.png) | [After](after-desktop.png) |
| Mobile, 390 × 844 | [Before](before-mobile.png) | [After](after-mobile.png) |

Additional **after-only** views (not comparison pairs):

- [Desktop data table](after-data-desktop.png) and [mobile data table](after-data-mobile.png): same primary fixture with **View data** expanded and the table scrolled into view.
- [Desktop gallery](after-gallery-desktop.png) and [mobile gallery](after-gallery-mobile.png): additional datasets/charts used by the browser interaction test, scrolled to grouped bars. These are a different fixture from the paired screenshots.

The baseline intermittently logs React hydration error 418; the after browser
runs reproduce the same warning. No other page errors or document horizontal
overflow were observed. The browser test explicitly tolerates at most that one
baseline warning per page; other errors fail. No claim of a warning-free
application or manual screen-reader audit is made.

Run the checked-in production browser test with:

```sh
pnpm build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome pnpm test:charts
```

The test creates and removes its own temporary data. `CHART_SCREENSHOT_DIR`
optionally saves screenshots of its richer gallery fixture. The paired captures
above used separate baseline/current production builds with only the identical
primary widget fixture, so gallery test captures must not replace them as a
like-for-like comparison.
