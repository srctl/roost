# Shared Feed

Feed is a separate, shared surface on the web and in the iPhone app. It combines articles from followed publications, stories written by a selected Roost agent, and optional important updates from that agent's connected email sources. Opening a story does not create a conversation; **Discuss** starts a reply thread with its source context.

## Setup

Open **Feed → Sources & preferences**, turn the feed on, and describe your interests and priorities. Capitol Hill Seattle Blog and The Seattle Times local RSS feeds are included as editable presets. Add other public RSS or Atom URLs, choose an optional editor agent, and set the refresh interval. Sources work without an editor; an editor adds sourced context and original synthesis. Email updates require selecting an agent with email access and enabling email updates explicitly.

Use **Saved** to return to stories you have kept. Stories are ordered by their original publication time and grouped into local morning, afternoon, evening, yesterday, and older dates. Saving, dismissing, restoring, and more/less feedback persist across web and mobile. Source articles retain an attributed excerpt and original link. Agent-written stories include useful standalone summaries, citations, and a relevant source image where one is available. Images appear beneath each story summary and in the reader; missing images leave a text-only story. Feed refresh errors appear in the feed rather than silently claiming a successful check.

## Jevi / Jev

Roost uses the Jev HTTP API directly; installing the Jevi CLI is unnecessary. Enable Jev relevance scoring and enter a TypeSafe API key in preferences, or provide `ROOST_JEV_API_KEY` (with `TYPESAFE_API_KEY` as a fallback). Environment keys take precedence. Saved keys live in `ROOST_DATA_DIR/secrets/feed-jev-key`, with owner-only permissions, and are never returned to the clients.

The pinned `jev-1.13.0` model scores relevance, importance, actionability, and novelty before an agent spends tokens writing. Requests use bounded public article excerpts, the configured interests/priorities, and public-story feedback/history. Scores are cached. Basic local matching keeps public sources useful without a key or during provider failures. Score confidence is not a factual-verification guarantee.

Private update snippets are excluded from public scoring. **Score private updates with Jev** is a separate opt-in; only then can a published personal update's short summary be sent to Jev. Important private updates remain visible even with a low or failed score. Email retrieval uses the editor agent's existing connected sources and permissions. It is read-only and bounded; Roost does not send, archive, delete, or mark email read as part of feed curation.

## Runtime and validation

The feed is disabled by default. When enabled, the server worker polls on the configured interval and handles manual refreshes through the same database lease. Fetches support RSS/Atom, conditional requests, redirect validation, public-address checks, and response limits. Candidate identity follows canonical URLs. Refreshes preserve saved/read state, publish only under current preferences, and queue the selected editor through Roost's durable run system. Email checks revisit a rolling 24-hour window with stable event keys, so an unavailable inbox or a previous pass with email disabled cannot advance a cursor past unseen messages. The initial version inspects at most 25 recent messages per pass and does not backfill older mail.

Data lives in additive `feed_*` tables in the existing agent database. Agent deletion removes publication/discussion receipts and detaches the editor while preserving shared feed history. Settings use revision checks so simultaneous web and mobile edits cannot silently overwrite one another.

Tests cover source parsing and network boundaries, mocked Jev protocol and consent, real SQLite persistence and migration, refresh leases and fallbacks, publication ownership and retries, and the authenticated mobile API. Browser and simulator flows cover the visible reading, preferences, saving, dismissal, and discussion paths. Live Jev scoring and a real connected-email run require configuring those services locally; the test fixtures use no real inbox or provider key.
