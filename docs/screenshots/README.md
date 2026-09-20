# User guide screenshots

## Current feature captures (v0.1.45)

These screenshots were captured on 2026-09-19 (Pacific time) from the real
Roost v0.1.45 web interface at source `7410cdc274bf3f8ddbdf6231090b8885ed47f9ff`.
All conversations, stories, tasks, reactions, and tracker values are fictional
sample data in a newly created temporary Roost store.

| Image | What it explains | Viewport |
| --- | --- | --- |
| `shared-feed.png` | Shared chronological Feed with a source image, dated story, personal update, and Save/Discuss controls | 1440 × 960 |
| `chat-trackers.png` | Interactive checklist in chat, a completed task, Add task control, Dashboard link, and emoji reaction | 1440 × 960 |

The captures use the current app's real routes, components, server stores, and
tracker persistence. The sample data was seeded locally; the text is not real
model output or evidence of live news retrieval. The local fixture used a fake
Codex provider and no real coding worker. No private user conversation or
connected-service content appears in these images. The Feed's photo was served
from the repository's existing local fixture. No product DOM or screenshot
pixels were edited.

The development build emitted StyleX source-attribute hydration diagnostics;
the depicted Feed, tracker, and reaction controls rendered. These web screenshots
do not demonstrate physical iPhone behavior, forecast accuracy, or background
agent execution.

### Feed photo credit

The photograph visible in `shared-feed.png` is **Seattle - Volunteer Park
Seventh Day Adventist Church 02**, by **Joe Mabel**, photographed April 3, 2017.
It is displayed at a reduced size within the app's image frame.

- [Original photograph and attribution](https://commons.wikimedia.org/wiki/File:Seattle_-_Volunteer_Park_Seventh_Day_Adventist_Church_02.jpg)
- [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
- [Repository fixture provenance](../../apps/web/tests/fixtures/feed-neighborhood-credit.md)

The photo illustrates a fictional neighborhood story, not actual reporting.
Keep the photo credit and license link alongside public uses of this screenshot.

## Earlier workflow captures (v0.1.41)

The following screenshots were captured on 2026-09-13 from the real Roost
v0.1.41 interface (source `ed3ca2e`) with fictional sample data:

| Image | What it explains | Viewport |
| --- | --- | --- |
| `reply-threads.png` | Main conversation alongside its focused reply thread | 1440 × 960 |
| `jobs-workspace.png` | Preview report, changes, and feedback saved without resuming a worker | 1440 × 960 |
| `appearance.png` | Rosé Pine Dark preview with Save and Cancel controls | 1440 × 960 |
| `dashboard-datasets.png` | Saved budget data, grouped bars, tasks, and chat | 1440 × 960 |
| `reply-thread-mobile.png` | Full-screen thread, parent context, and composer | 390 × 844 |

These are browser screenshots, not mockups. The isolated
`tests/fixtures/jobs-preview/` runtime used a newly seeded temporary data store,
simulated Herdr transport, and a fake Codex provider. The garden conversation,
budget dataset, and spending-view assignment were seeded solely for these
captures. The preview address is an example domain, not a deployment. No live
agent data, connected account, or real coding worker was used.

The fixture runs the app in development mode. Development-only StyleX source
attribute hydration warnings were observed; the captured workflows and chart
rendered. These images explain the UI and are not evidence of real model output,
worker execution, preview uptime, or physical iPhone behavior.

Guides label sample data and link each image to its full-size file. The docs
site publishes referenced files under `/media/`; the Markdown files also work
when viewed directly in the repository. Re-capture when the relevant UI changes.
