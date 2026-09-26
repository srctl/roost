# Roost Expo prototype

An Expo (SDK 57, React Native 0.86) prototype of four core screens from the
SwiftUI app in `apps/ios`, built to compare feel and decide whether React
Native is worth adopting. It talks to the same `/api/mobile/v1` API with a
device token, so it runs against a real Roost server or the native UI fixture.

It is not part of the pnpm workspace and has its own `package-lock.json`.

## What is ported

| Screen | Ported | Left out |
| --- | --- | --- |
| Connect | Server + token validation, session/agents check, secure storage (Keychain via `expo-secure-store`) | Token replacement, help sheet (uses an alert) |
| Agents | Native large-title list, search bar, pull to refresh, 15s foreground refresh | Sections, reorder, rename/delete, activity badges, create |
| Chat | Revision polling (1s busy / 4s idle / 8s error), idempotent send + retry, stop, approvals, reply threads, swipe-to-reply with haptic, long-press menu, typing indicator, entrance animation, keyboard-aware inverted list | Attachments, image previews, inline dashboards, draft persistence, activity details, message flight animation, Codex style |
| Feed | All/Saved filter, time-of-day sections, images, save/dismiss (long press), reader in a native form sheet | Swipe actions, preferences, discuss, pagination |

## Native controls

On iOS the chrome and controls are system components, so they pick up
Liquid Glass and the system animations on iOS 26:

- Tabs: `NativeTabs` (UITabBarController).
- Header buttons and menus: `Stack.Toolbar` (UIBarButtonItem + UIMenu).
- Buttons: `NativeButton` renders a SwiftUI `Button` with `.buttonStyle(.glass)`
  or `.glassProminent` via `@expo/ui/swift-ui` (`native-button.ios.tsx`).
- Composer: `GlassView` from `expo-glass-effect` (UIGlassEffect).
- Message long-press: SwiftUI `.contextMenu` via `@expo/ui` (`message-menu.ios.tsx`).

Android and web use the plain React Native fallbacks in the same folders.

Themes and pixel characters are read straight from
`apps/ios/Roost/Resources/*.json`, so both apps share one source of truth.

## Run it

```sh
# Terminal 1: local fixture server on 127.0.0.1:4399 (repo root)
corepack pnpm install && corepack pnpm dev:mobile-fixture

# Terminal 2
cd apps/mobile-expo
npm install
npx expo run:ios        # development build on the simulator (needs Xcode)
# or: npx expo start --web
```

Connect with server `http://127.0.0.1:4399` and token
`roost_mobile_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (43 `a`s, fixture only).

Expo Go is not enough: `react-native-keyboard-controller` needs a
development build. On web the mobile API rejects browser `Origin` headers,
so the web build needs a same-origin proxy that strips them.

Xcode 27 builds need the UIScene life cycle or the app is killed at launch.
`plugins/with-scene-lifecycle.js` switches the generated project to Expo's
`ExpoAppSceneDelegate` during prebuild, so leave it in `app.json`. CocoaPods
also needs a UTF-8 locale (`export LANG=en_US.UTF-8`) or `pod install` fails.

## Updates without store review

`expo-updates` is installed. A release build checks for a new JS bundle at
launch and switches to it on the next launch, on iOS and Android alike.

- Only JS and assets ship this way. Adding a native module, changing
  permissions or native `app.json` settings, or bumping the Expo SDK needs a
  new store build.
- `runtimeVersion` uses the `fingerprint` policy: it is a hash of the native
  project, so an update only reaches binaries whose native code can run it.
- `eas.json` builds `preview` (internal install) and `production` binaries
  on matching update channels, so an update can go to your phone first.
- There is no update server yet. `updates.url` is unset, which leaves updates
  off in release builds and does nothing in development builds. To use EAS,
  run `npx eas-cli init` and `npx eas-cli update:configure` (they add the
  project id and `updates.url`), make a build per platform, then publish with
  `npx eas-cli update --channel preview`. A self-hosted server that speaks the
  Expo Updates protocol can take the place of EAS by pointing `updates.url` at it.

## Checks

```sh
npx tsc --noEmit
npx expo export --platform ios --platform android   # JS bundles build
corepack pnpm lint                                   # from repo root (Biome)
```
