# Mobile and home-screen installation

Open your Roost HTTPS address in Safari, then choose **Share → Add to Home Screen**
and open it as a web app. Roost provides a standalone manifest, app icons, and an
Apple touch icon. The page and browser chrome follow the device's light/dark
appearance. The installed iOS status bar overlays a safe-area-padded header.

Startup at `/` reopens the last agent visited in this browser or home-screen app.
The choice is stored locally on the device. If the agent is missing, storage is
unavailable, or no agent has been visited yet, startup shows the agent list.
Direct links keep their destination. Tap **roost** in navigation to open the list
without being redirected; an empty workspace offers **Create an agent**.

Swipe right across the page to open the agent picker, or tap the menu button.
Use a short, mostly horizontal swipe outside text inputs, controls, and horizontally
scrolling content such as code blocks and tables. Swipe left across the drawer
to dismiss it, including across an agent row. You can also select an agent, tap
outside the drawer, or use its close button.

On phones, the document stays fixed while the conversation or settings content
scrolls inside it. While the keyboard is closed, browser tabs use the dynamic
viewport (`100dvh`), while installed standalone apps use the full viewport
(`100vh`) for both the document and app shell. iOS can underreport dynamic and
percentage heights in standalone mode, leaving a bottom gap. Safe-area padding
is applied inside that full height, once at the header and composer.
While an input is focused and the keyboard reduces the available height, the app
follows the visual viewport's height and top offset. On blur it removes those
overrides, including when iOS retains a stale visual viewport size. The composer uses 16px text to avoid input zoom and
removes the home-indicator inset while the keyboard occupies that space.

Production builds register a service worker that caches immutable build assets,
supports push notifications, and supplies an offline screen when a navigation
cannot reach the server. It does not cache conversations, credentials, attachments,
HTML pages, or API responses. See [startup measurements](pwa-startup.md) and
[notification setup](notifications.md). Updates arrive on the next
page load; an active conversation is never automatically reloaded. Roost still
requires a connection to its server to send messages or control the computer.

Home-screen icon links use versioned PNGs from Roost's public GitHub repository.
iOS may fetch these without the browser's authentication cookie, so serving them
behind an authenticated private proxy can produce a blank icon. Only public branding
assets use this URL; the app, conversations, and desktop remain authenticated.
The SVG favicon and local PNG copies are also included in every release.

After an update, reload the page. If iOS retains an old home-screen icon or launch
appearance, remove the shortcut and add it again. Desktop WebKit emulation covers
layout checks, but keyboard animation and installed status-bar behavior also need
checking on a physical iPhone.

The standalone height workaround follows [WebKit bug 254868](https://bugs.webkit.org/show_bug.cgi?id=254868#c2).
If installed before the status-bar metadata was added, iOS may require removing
and re-adding the home-screen app; [WebKit bug 316008](https://bugs.webkit.org/show_bug.cgi?id=316008)
describes metadata captured at install time that does not update afterward.
