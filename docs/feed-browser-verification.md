# Feed browser verification

Verified the production web build on September 19, 2026 using the Playwright CLI at desktop (1440 × 1000) and phone (390 × 844) viewport sizes.

All content was clearly labeled synthetic sample data in an isolated temporary Roost data directory. The feed remained paused, no publication imports or live Jev requests ran, and contextual discussion used `tests/fixtures/chat-server.mjs` with fake credentials. The article uses the credited neighborhood photograph below, supplied through a browser-only fixture route.

Verified:

- Shared Feed navigation and mixed article/story/personal-update stream.
- Save → Saved filtering, with saved state retained after a full reload.
- The chronological stream shows This evening, This afternoon, This morning, and Yesterday sections based on local publication time. Unread filters and read indicators are absent.
- Full three-sentence summaries render without line clamping. The landscape photo sits below its summary at both viewport sizes, with a bounded 440 px width on desktop.
- The compact Updates paused control opens preferences; no paused banner occupies the feed.
- A failed image is removed along with its empty image control; article text and actions remain usable.
- Dismiss removes the item; Undo restores it.
- Interests and priorities survive save and reload.
- A fake saved Jev key reopens as an empty password input, never appears in page markup, and private scoring remains unchecked.
- Reader Escape closes and restores focus to its opener.
- Desktop and phone feed, reader, and preferences have no horizontal overflow.
- Direct Discuss opens a dedicated reply thread with the selected story, source citations, a concise discussion prompt, and a response from the fake provider.

Browser QA found and corrected a StyleX border-shorthand issue. Explicit border width, style, and color now render the editorial dividers and input borders correctly. The production build passed after the fix.

Screenshots:

- [Desktop feed](screenshots/feed/feed-desktop.png)
- [Desktop reader](screenshots/feed/feed-reader-desktop.png)
- [Desktop preferences](screenshots/feed/feed-preferences-desktop.png)
- [Phone feed](screenshots/feed/feed-phone.png)
- [Phone reader](screenshots/feed/feed-reader-phone.png)
- [Phone preferences](screenshots/feed/feed-preferences-phone.png)
- [Phone contextual discussion](screenshots/feed/feed-discussion-phone.png)

These screenshots document browser layout and interaction checks, not live news or a live model-quality evaluation.

## Neighborhood photo attribution

The visual fixture uses Joe Mabel's photograph, **Seattle - Volunteer Park Seventh Day Adventist Church 02.jpg**, taken April 3, 2017 at 13th and Aloha in Capitol Hill, Seattle.

- [Original file and attribution](https://commons.wikimedia.org/wiki/File:Seattle_-_Volunteer_Park_Seventh_Day_Adventist_Church_02.jpg)
- [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
- [1280px source rendition](https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Seattle_-_Volunteer_Park_Seventh_Day_Adventist_Church_02.jpg/1280px-Seattle_-_Volunteer_Park_Seventh_Day_Adventist_Church_02.jpg)

The downloaded photo is unchanged; the interface scales and responsively crops it. The photograph and its displayed crops retain CC BY-SA 4.0. Attribution and license links are also present in the synthetic story body and citations. The accompanying sample story is a visual test fixture, not a current news report or an endorsement by the photographer.
