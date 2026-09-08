# Settings update status: rendered evidence

Actual Chromium screenshots of the source app with isolated disposable data,
light theme, device scale factor 1. Baseline: `7415789` (0.1.40). After: this
implementation branch. Both states use `/settings`, search `software update`,
the same viewports and the same empty app data. Screenshots are full-page captures
and therefore may differ in total image height as content changes.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop 1440 × 1000 | [Before desktop](before-desktop.png) | [After desktop](after-desktop.png) |
| Mobile 390 × 844 | [Before mobile](before-mobile.png) | [After mobile](after-mobile.png) |

Before: no matching setting. After: source-build capability, externally managed
reason and disabled update check. These images show the implemented status UI,
not a working enrollment/activation/reconnect flow. No mockups substitute for
missing lifecycle screenshots. Screenshot scripts and server logs remain in
`/tmp`, outside the PR.
