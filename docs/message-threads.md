# Message threads

The assistant message’s “Reply in thread” icon creates or reopens one thread per
message. It sits just outside the message or bubble’s right edge, near the bottom.
The message and control share a hover area, including the gap between them. The
icon appears on hover or keyboard focus and stays visible on touch/no-hover devices. User messages do not offer new thread
creation. Existing thread counts, unread markers and status remain available on historical roots,
including user messages, and reopen their threads. Main stays
mounted beside the thread on desktop; mobile makes the background inert and shows
the thread full screen. Escape and Close restore the opener. The original parent,
including files, remains available even if its timeline row later disappears.
Reply counts include user and assistant messages, excluding tools and notices.
Unread markers use the last viewed revision in browser storage; hidden tabs do
not acknowledge new replies. Draft text, attachment references, pending send IDs,
and scroll offsets are stored separately per conversation in session storage.
Drafts intentionally belong to a tab; read markers are shared across tabs.

## Identity and persistence

The agent's UUID is its stable main conversation ID. Child UUIDs and explicit
parent conversation/message references live in `conversation_records`. Product
conversation IDs are independent of Codex native thread IDs. `conversation_sessions`
retains the native provider, model, thread ID, and archive. This release supports
the existing Codex provider; it does not invent another provider or reinterpret
native IDs as product IDs. Migrated rows preserve the existing agent model; old
message timestamps unavailable in the original schema are returned as unknown.

Schema migrations 11–13 preserve timeline positions/revisions, runs/ownership,
legacy session tables, archives and instruction versions. `provider_message_ids`
keeps existing message IDs stable on migration and scopes new provider IDs to
the native session. Native session rollover retains archive provenance so old
assistant/tool messages do not reappear under new IDs. Transactions serialize
create/reopen and send retries; a reused send ID with different content, files,
agent, or conversation is rejected.

One run per agent remains active. Follow-ups steer only that conversation;
other conversations queue. Cancellation, approval notices, coding-job updates,
delegation handoffs, partial output, errors and restart notices carry the run's
origin. Automation and reflection results continue to default to main. A missing
nonempty source run is an error, never a fallback destination. Thread deletion
uses a tombstone, fences new sends/reopens and requests cancellation; archived
rows remain in the origin and are excluded from retrieval. No cascading history
or native-session deletion is performed.

## Shared context

A new child session receives its parent and bounded recent main/reply context.
`roost_read_conversations` reads only the runtime agent's conversations. It accepts
an optional conversation ID, a text query, limit (1–20), and forward `after`
pagination; `newest: true` returns recent decisions with `before` pagination.
Each result includes stable message/conversation IDs, author, timestamp when
known, a link and text capped at 1,500 characters. Results are explicitly quoted
context, never instructions or authorization. Retrieval does not post a reply
elsewhere. Normal provider resume retains the child session; failed/interrupted
runs are visible and never silently replayed after restart.

## Verification

`pnpm check` runs unit/integration tests and the existing production/site checks.
`tests/threads.test.ts` covers v8 migration, identity, bounded retrieval, access,
queue/steering, duplicate requests, collision safety, tombstones and parent loss.
`tests/threads-worker.test.ts` uses the real worker and local JSONL provider
fixture for resume/rollover, newer-main/sibling tool retrieval, child approvals,
attachments and delayed delegation. The coding regression covers delayed child
job reports after main work starts. Service-worker tests validate notification
conversation URLs without accepting arbitrary query parameters or fragments.

Run the browser regressions after building:

```sh
pnpm build
pnpm exec playwright install chromium
pnpm test:threads:browser
```

To use an already installed Chromium/Chrome instead of downloading one:

```sh
ROOST_TEST_CHROME=/path/to/chrome pnpm test:threads:browser
```

The browser harness creates its own temporary database, fixture agent workspaces,
Codex credentials containing only a dummy key, random loopback listener and
browser contexts. It never accepts a live Roost URL. It verifies matching desktop
and mobile interactions: independent drafts, attachment draft/send/reload,
focus containment/restoration, scoped older-message anchors and stable scroll,
unread switching, streamed output, newer-main/sibling runtime retrieval, visible
queue state and origin cancellation. It removes only its own temporary fixture.

Browser storage availability is required for local draft/read-marker persistence.
