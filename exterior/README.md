# Exterior message reply action — final placement

Latest feedback supersedes the inside-box layout: move the icon just outside the assistant bubble’s right edge near its bottom.

Before: PR35 `1601ac227b6ca39841fbe5af1d3561107b91ae43`. After: `415367c92219004d770c75d0838a888eac99d7ed`.

40 actual rendered matched screenshots from isolated synthetic fixtures. Desktop1440×1000 rest/hover/focus; mobile-touch390×844 rest/focus; document and bubble, light and dark. No user data or real providers.

Final behavior: a neutral group reserves a 4px exterior gap, 40px control, and focus-ring space. Article padding is restored to normal. The group includes message/gap/control in the hover area, so pointer travel preserves visibility. Short replies fit their content; the group remains capped to available width on mobile. The target ends 4px above the article bottom; there is no row below. The create/reopen icon stays mounted across thread refresh, and historical count/unread navigation remains visible.

| State | Before (inside box) | After (exterior gutter) |
| --- | --- | --- |
| desktop-dark-focus | ![Before: desktop-dark-focus](before-desktop-dark-focus.png) | ![After: desktop-dark-focus](after-desktop-dark-focus.png) |
| desktop-dark-hover | ![Before: desktop-dark-hover](before-desktop-dark-hover.png) | ![After: desktop-dark-hover](after-desktop-dark-hover.png) |
| desktop-dark-rest | ![Before: desktop-dark-rest](before-desktop-dark-rest.png) | ![After: desktop-dark-rest](after-desktop-dark-rest.png) |
| desktop-light-focus | ![Before: desktop-light-focus](before-desktop-light-focus.png) | ![After: desktop-light-focus](after-desktop-light-focus.png) |
| desktop-light-hover | ![Before: desktop-light-hover](before-desktop-light-hover.png) | ![After: desktop-light-hover](after-desktop-light-hover.png) |
| desktop-light-rest | ![Before: desktop-light-rest](before-desktop-light-rest.png) | ![After: desktop-light-rest](after-desktop-light-rest.png) |
| messages-desktop-dark-focus | ![Before: messages-desktop-dark-focus](before-messages-desktop-dark-focus.png) | ![After: messages-desktop-dark-focus](after-messages-desktop-dark-focus.png) |
| messages-desktop-dark-hover | ![Before: messages-desktop-dark-hover](before-messages-desktop-dark-hover.png) | ![After: messages-desktop-dark-hover](after-messages-desktop-dark-hover.png) |
| messages-desktop-dark-rest | ![Before: messages-desktop-dark-rest](before-messages-desktop-dark-rest.png) | ![After: messages-desktop-dark-rest](after-messages-desktop-dark-rest.png) |
| messages-desktop-light-focus | ![Before: messages-desktop-light-focus](before-messages-desktop-light-focus.png) | ![After: messages-desktop-light-focus](after-messages-desktop-light-focus.png) |
| messages-desktop-light-hover | ![Before: messages-desktop-light-hover](before-messages-desktop-light-hover.png) | ![After: messages-desktop-light-hover](after-messages-desktop-light-hover.png) |
| messages-desktop-light-rest | ![Before: messages-desktop-light-rest](before-messages-desktop-light-rest.png) | ![After: messages-desktop-light-rest](after-messages-desktop-light-rest.png) |
| messages-mobile-touch-dark-focus | ![Before: messages-mobile-touch-dark-focus](before-messages-mobile-touch-dark-focus.png) | ![After: messages-mobile-touch-dark-focus](after-messages-mobile-touch-dark-focus.png) |
| messages-mobile-touch-dark-rest | ![Before: messages-mobile-touch-dark-rest](before-messages-mobile-touch-dark-rest.png) | ![After: messages-mobile-touch-dark-rest](after-messages-mobile-touch-dark-rest.png) |
| messages-mobile-touch-light-focus | ![Before: messages-mobile-touch-light-focus](before-messages-mobile-touch-light-focus.png) | ![After: messages-mobile-touch-light-focus](after-messages-mobile-touch-light-focus.png) |
| messages-mobile-touch-light-rest | ![Before: messages-mobile-touch-light-rest](before-messages-mobile-touch-light-rest.png) | ![After: messages-mobile-touch-light-rest](after-messages-mobile-touch-light-rest.png) |
| mobile-touch-dark-focus | ![Before: mobile-touch-dark-focus](before-mobile-touch-dark-focus.png) | ![After: mobile-touch-dark-focus](after-mobile-touch-dark-focus.png) |
| mobile-touch-dark-rest | ![Before: mobile-touch-dark-rest](before-mobile-touch-dark-rest.png) | ![After: mobile-touch-dark-rest](after-mobile-touch-dark-rest.png) |
| mobile-touch-light-focus | ![Before: mobile-touch-light-focus](before-mobile-touch-light-focus.png) | ![After: mobile-touch-light-focus](after-mobile-touch-light-focus.png) |
| mobile-touch-light-rest | ![Before: mobile-touch-light-rest](before-mobile-touch-light-rest.png) | ![After: mobile-touch-light-rest](after-mobile-touch-light-rest.png) |
