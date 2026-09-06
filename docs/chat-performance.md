# Conversation performance — 0.1.17

Measured on macOS with Node 24.15.0, a production Vite build, and isolated Chromium. The fixture contains 3,000 messages: alternating user, Markdown assistant, and tool activity entries, with eight repeated Markdown sections per assistant response. No chats were submitted to production agents and the signed-in desktop was not used.

| Measurement                                      |                    0.1.16 |          0.1.17 |
| ------------------------------------------------ | ------------------------: | --------------: |
| Initial HTML (decoded bytes)                     |                 7,094,517 |          10,592 |
| DOM ready                                        |                  1,592 ms |          397 ms |
| DOM nodes after initial history                  |                    65,077 |           1,381 |
| Initial history response (framework encoding)    |           3,387,824 bytes |    73,906 bytes |
| Unchanged conversation poll                      |           3,387,824 bytes |       384 bytes |
| Observed idle main-thread tasks                  | repeated 550–660 ms tasks | none over 50 ms |
| SQLite read + JSON serialization, entire history |                   6.38 ms |               — |
| SQLite latest-page read                          |                         — |         0.48 ms |
| SQLite unchanged cursor read                     |                         — |        0.049 ms |

These are individual local observations, not statistical latency percentiles or measurements over a mobile network. The raw Markdown SSR baseline took 725 ms. Transport byte counts include the framework's serialization, while SQLite page figures do not.

## Findings and changes

- Agent-route loading previously awaited the complete timeline. The route now renders navigation and the editable composer before fetching history; sending is disabled until the first snapshot establishes run state.
- Imported timelines do not repeatedly contact Codex. `ensureTimeline` still imports legacy history once, but it no longer blocks the route shell. Root agent listing and desktop status are local reads; they do not start a Codex runtime.
- History starts with the latest 60 entries. Older pages remain available, with scroll anchoring when prepended.
- A transactional revision cursor returns only changed entries, including edits to existing messages. Unchanged polls keep existing React message references. Markdown rendering is memoized.
- SQLite indexes cover agent/position, agent/revision, and active runs. Revision triggers cover all timeline writers. Identical message upserts avoid writes.
- Tool text/input previews are bounded to 2,000 characters each. Full output is retained in SQLite and can be loaded explicitly from the details panel. This matters for the actual production shape: 142 entries totaled 20,302,781 bytes; the latest-page preview projection was 60,775 bytes.
- The desktop panel is lazy loaded. Active desktop discovery also checks outside the loaded page, preserving inline preview behavior for long active runs. Settings and delegation behavior remain covered by existing checks.

## Interaction checks

- A measured agent switch took 23 ms. The composer accepted typing while the history response was deliberately delayed by two seconds.
- Loading an older page shifted the previously visible text by 0.25 px.
- At a simulated 390 × 844 viewport, the body remained 390 px wide and the composer stayed inside the viewport. This is not physical iPhone, Safari keyboard, or installed-PWA verification.
- A fixture-only timeline append appeared through polling. A one-megabyte tool output was initially bounded and its final marker became visible after explicitly loading full output.
- Existing regression checks cover desktop preview anchoring, settings, durable runs, delegation, release rollback, and schema migration. The timeline regression covers pagination, cursor batches, edits, agent isolation, output retention, and unchanged snapshots.

## Limits

Loading many older pages intentionally increases the mounted history; this change does not introduce full list virtualization. Explicitly opening a very large complete tool output can still cost rendering time. First-time legacy imports can still take time, but navigation and typing remain available. Polling remains one second for live updates; it now transfers only changes.
