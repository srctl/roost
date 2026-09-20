# Feed browser verification

Verified the production web build on September 19, 2026 using the Playwright CLI at desktop (1440 × 1000) and phone (390 × 844) viewport sizes.

All content was clearly labeled synthetic sample data in an isolated temporary Roost data directory. The feed remained paused, no publication imports or live Jev requests ran, and contextual discussion used `tests/fixtures/chat-server.mjs` with fake credentials. The article image was an existing Roost dashboard screenshot, supplied through a browser-only fixture route.

Verified:

- Shared Feed navigation and mixed article/story/personal-update stream.
- Save → Saved filtering, with saved state retained after a full reload.
- Opening a story marks it read and excludes it from Unread.
- Dismiss removes the item; Undo restores it.
- Interests and priorities survive save and reload.
- A fake saved Jev key reopens as an empty password input, never appears in page markup, and private scoring remains unchecked.
- Reader Escape closes and restores focus to its opener.
- Phone feed and preferences have no horizontal overflow.
- Discuss opens a dedicated reply thread with the selected story, source citations, and a response from the fake provider.

Browser QA found and corrected a StyleX border-shorthand issue. Explicit border width, style, and color now render the editorial dividers and input borders correctly. The production build passed after the fix.

Screenshots:

- [Desktop feed](screenshots/feed/feed-desktop.png)
- [Desktop reader](screenshots/feed/feed-reader-desktop.png)
- [Desktop preferences](screenshots/feed/feed-preferences-desktop.png)
- [Phone feed](screenshots/feed/feed-phone.png)
- [Phone reader](screenshots/feed/feed-reader-phone.png)
- [Phone preferences](screenshots/feed/feed-preferences-phone.png)
- [Phone contextual discussion](screenshots/feed/feed-discussion-phone.png)

These screenshots document browser layout and interaction checks, not live news or a live model-quality evaluation. The discussion screenshot predates the later concise prompt wording change.
