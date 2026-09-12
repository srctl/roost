# Shared agent note

Each agent has one persistent **Note**, beside Chat and Dashboard (when enabled).
It belongs to the agent rather than a conversation thread. It is separate from
SOUL.md and Codex's private memory, and it is visible and editable by the user.
Changing or starting a message thread does not replace it.

Use the note for a shared plan, reference details, or next steps. Paragraphs,
three heading levels, bullet and numbered lists, and interactive to-dos are
supported. Type `# `, `## `, `### `, `- `, `1. `, or `[] ` to start a block.
Type `/` to search the block menu; use arrows and Enter, or tap a choice. The
**+ Block** button opens the same menu without typing. Escape closes it. Select
text to apply bold, italic, or a link from the toolbar. Undo and Redo work during
an editing session, including after successful autosaves. Remote adoption,
explicit reload, merge, and restore start a fresh undo history; Undo cannot
remove an agent update from a previous editing session. Use revision history
to restore older saved content.

**Maintenance instructions** are optional, collapsible, and saved separately.
They tell the agent how to maintain the note; they never replace the note or
permit purchases, messages, deployments, or other external actions. Only the
user can edit these instructions. Agents must read both the current note and
instructions before making a targeted, user-authorized edit. Existing approval
boundaries still apply.

## Saving, conflicts, and recovery

Changes save after a short pause. The page reports Saving, Saved, or an error.
While offline, drafts remain in browser storage on the current device. Reconnect
to resume; if the server note changed, autosave pauses for reconciliation. A
reopened note offers to recover an unsaved draft. Do not clear browser storage
until drafts have been saved or downloaded. If browser storage is unavailable,
keep the page open until saving succeeds.

An unsaved-draft recovery prompt keeps the saved note read-only until the user
chooses to recover or discard the draft.

The page polls for changes every five seconds. It never replaces the editor
while it has focus or has unsaved changes. Saves do not reset selection or undo.
Concurrent changes to different blocks can be merged explicitly. Overlapping
edits and reordering are not guessed: download the draft, reload the saved note,
and reapply the intended changes. Reload/discard actions explicitly discard the
local draft. Older poll responses cannot roll back a newer save.

History shows who changed the note, with revision previews and pagination. A
restore creates a new revision and preserves current maintenance instructions.
Save or resolve local edits before restoring. The server retains all revisions
and retry records; storage grows with the note's edit history. No-op saves do not
create revisions. Back up the Roost data directory to preserve notes and history.

## Content and storage contract

The browser and server share a validated structured format in
`src/features/notes/schema.ts`. There are at most 500 blocks, 500 inline spans per
block, 20,000 characters per span, and 200,000 serialized characters per note.
Maintenance instructions allow 8,000 characters. Each block has a UUID `id`, a
`type` (`paragraph`, `heading`, `bullet`, `ordered`, or `todo`), and inline
`content`. Spans contain text and optional bold, italic, and URL fields. Headings
use levels 1–3; to-dos have a checked flag. New and split blocks receive fresh
IDs; edits to an existing block retain its ID. Duplicate IDs are rejected.

Only HTTP, HTTPS, and mailto links are accepted. Renderers escape text and never
inject note HTML. Pasted HTML is reduced to supported rich text; scripts,
embedded content, event attributes, unsafe URLs, and copied IDs are removed.
Lists are flat: indentation is disabled and pasted nested lists are flattened.
Code, blockquotes, images, tables, strike, and underline are not offered as
editable note formats. Line breaks, links, heading levels, and task completion
survive save/reload.

Schema migration 11 adds `agent_notes`, `note_revisions`, `note_requests`, and
`note_reads`, after main's schema 10 migration. Content, instruction, and restore
writes use `BEGIN IMMEDIATE`, validate the agent, check maintenance availability,
and compare the current revision. The entire transaction succeeds or rolls back.
Each successful change advances a shared monotonic revision, so concurrent
instruction changes also invalidate agent reads. Requests have stable UUIDs;
an identical retry returns its original result, while reusing a UUID for another
payload is rejected. Request IDs are scoped to the owner agent.

## APIs and agent tools

The Start functions in `src/features/notes/functions.ts` provide current reads,
content and instruction saves, paginated history, revision inspection, and
restore. The application authentication and same-origin gates protect them;
`available` and store-level maintenance checks follow other Roost features.
Roost has one authenticated application owner. Agent tool ownership is narrower:
the caller's server-owned agent ID is used, with no owner ID accepted in tool
arguments.

- `roost_read_note`: current content, instructions, revision, and a one-hour
  read token scoped to this agent and run.
- `roost_patch_note`: up to 100 targeted edits with the current revision, read
  token, and a stable UUID request ID. Every edit includes the exact `before`
  block; replacements retain its ID. Insertions use `before: null` and an
  explicit `afterId` anchor (`null` means the beginning). Deletions use
  `after: null`.
- `roost_note_history`: up to 100 revision metadata records, newest first;
  pass `before` with the oldest returned revision for the next page.
- `roost_read_note_revision`: inspect an owner-scoped historical snapshot before
  proposing restore. Historical instructions are not current authorization.
- `roost_restore_note`: user-requested content restore with current revision,
  read token, request ID, and target revision. Instructions remain unchanged.

Read tokens prove the current note and instructions were returned in this run;
they do not grant external permissions. Reflection and mutation-disabled runs
cannot write notes. A stale write returns `NOTE_CONFLICT` without mutation. The
agent must read again, retain unrelated blocks, and construct a fresh targeted
edit only if its intended change remains valid. It must not replace the whole
note to resolve a conflict. Tool version 13 refreshes existing persistent
threads to include these tools.

## Editor choice and validation

Tiptap 3.31.3 was selected over Lexical after reviewing both maintained projects.
Both cores are MIT licensed ([Tiptap license](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md),
[Lexical license](https://github.com/facebook/lexical/blob/main/LICENSE)).
Tiptap's pinned React package declares React 19 support. Its documented
[`immediatelyRender: false`](https://tiptap.dev/docs/editor/getting-started/install/nextjs)
setup defers the editor until hydration; Roost renders a safe text preview first.
Its existing heading/list input rules, task-list support, history, and UniqueID
extension cover this feature with less custom editor machinery.

[Lexical's React integration](https://lexical.dev/docs/react/) is a credible
alternative with modular plugins and an accessibility focus. It would also
require application-owned slash menus, toolbars, stable persisted identities,
and a persistence adapter. The choice here favors Tiptap's existing block and
input-rule extensions, not a claim that one framework guarantees accessibility.
Roost owns labels, focus handling, live save status, touch targets, menu keyboard
navigation, and safe link entry. Browser review covers these application details.

Bundle measurement compares production client JavaScript assets against
`origin/main` at `7415789` using raw and individually gzipped file sizes. The
baseline contains 46 JavaScript files: 1,860,935 bytes raw and 564,989 bytes gzip.
The final build contains 49 JavaScript files: 2,287,181 bytes raw and 699,096
bytes gzip, an increase of **426,246 bytes raw / 134,107 bytes gzip**. The
route-split Note asset accounts for 417,122 bytes raw / 130,670 bytes gzip.
Measurements sum file sizes and Node's default `gzipSync` output for each
`.output/public/**/*.js` file. This is a whole-application asset comparison,
not an isolated editor benchmark.

`tests/notes.test.ts` and `tests/notes-editor.test.ts` cover persistence, owner/run boundaries, stale writes,
read-before-edit, exact targeted edits, instruction independence, retries,
revision inspection, pagination/restore, content bounds, unsafe URLs, escaped
server rendering, editor round trips, and three-way recovery. The production
authentication check exercises every note server function without a session and
with a foreign origin. Run `pnpm check` for the repository's complete validation.

Browser validation used Chromium at desktop and mobile-emulated viewports. It
covered every typing shortcut, slash keyboard/touch insertion, formatting and
link focus, checkbox interaction, autosave/reload, hostile HTML paste and copied
IDs, failed-save retry, owner-preserving agent edits, overlapping conflict
rejection, safe different-block merge, offline draft recovery, revision
inspection/restore, and remote adoption followed by Undo/Ctrl+Z. Remote adoption
starts an empty local history, so Undo cannot remove the agent's change. Mobile
axe checks found no violations; desktop retained three existing sidebar contrast
findings (Agents, Create agent, Settings), outside the note surface. A reduced
viewport simulated keyboard occlusion. Physical iOS/Android keyboards and screen
readers have not been validated.
