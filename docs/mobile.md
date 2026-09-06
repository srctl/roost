# Mobile and home-screen installation

Open your Roost HTTPS address in Safari, then choose **Share → Add to Home Screen**
and open it as a web app. Roost provides a standalone manifest, app icons, and an
Apple touch icon. The page and browser chrome follow the device's light/dark
appearance. The installed iOS status bar overlays a safe-area-padded header.

On phones, the document stays fixed while the conversation or settings content
scrolls inside it. The app follows the visual viewport's height and top offset
as Safari opens the keyboard. The composer uses 16px text to avoid input zoom and
removes the home-indicator inset while the keyboard occupies that space.

Production builds register a small service worker that only supplies an offline
screen when a navigation cannot reach the server. It does not cache conversations,
credentials, API responses, or application bundles. Updates arrive on the next
page load; an active conversation is never automatically reloaded. Roost still
requires a connection to its server to send messages or control the computer.

After an update, reload the page. If iOS retains an old home-screen icon or launch
appearance, remove the shortcut and add it again. Desktop WebKit emulation covers
layout checks, but keyboard animation and installed status-bar behavior also need
checking on a physical iPhone.
