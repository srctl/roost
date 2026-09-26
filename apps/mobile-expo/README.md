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

## Checks

```sh
npx tsc --noEmit
npx expo export --platform ios --platform android   # JS bundles build
corepack pnpm lint                                   # from repo root (Biome)
```
