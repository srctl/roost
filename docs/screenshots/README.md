# User guide screenshots

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
