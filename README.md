# Roost

For Linux installation, updates, and `roost server` commands, see [the installation guide](docs/install.md).

A home for persistent AI agents and their work. Roost is intended to be
self-hostable, with each agent owning its conversations, tasks, schedules,
and approvals.

Roost connects to Codex, creates persistent agents, and lets you talk directly to
each agent. Replies update live in the conversation. Each agent has an ongoing
Codex chat thread and can run scheduled work in separate threads. SQLite stores
agent settings, the visible conversation, soul change history, automations, and
runs; Codex retains its native thread history in each agent's private home.

This first conversation pass supports text, sending, stopping, restored history,
thinking summaries, and expandable tool calls and output. The sidebar can be
collapsed with its toggle. Leaving the page detaches the view; server-owned work
continues until it finishes or you press Stop. Attachments and interactive tool
approvals are not implemented yet.

For a live desktop preview and agent access to the machine’s signed-in browser,
see [shared computer setup](docs/computer.md).

## Development

Requires Node.js 22.13+ and pnpm 9.15.0 (via Corepack).

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev     # One development server for the full application
corepack pnpm check   # Typecheck, regression tests, formatting, and build
```

For production:

```sh
corepack pnpm build
HOST=127.0.0.1 corepack pnpm start
```

The Nitro Node adapter emits `.output/server/index.mjs` and `.output/public`.
`pnpm start` runs one Node server that handles requests and serves the UI assets.
Set `PORT` and `HOST` to configure the production listener. This is currently a
local, single-user application without application-level authentication. Keep the
listener on loopback.

## Application structure

- `src/router.tsx`: creates a fresh TanStack Router instance for each request.
- `src/routes/__root.tsx`: HTML document, metadata, stylesheet, and Start scripts.
- `src/routes/index.tsx`: the welcome page.
- `src/routes/agents.*.tsx`: agent creation and saved agent pages.
- `src/features/agents`: shared validation, styling, and Start server functions.
- `src/routeTree.gen.ts`: generated route tree; let the Start plugin update it.
- `src/components`: React components, including the conversation building blocks.
- `src/styles`: StyleX tokens and the global CSS reset.
- `src/server`: server-only Effect programs for SQLite storage and the Codex transport.
- `src/features/chat`: typed server functions and polling of persisted live chat state.
- `src/server/runs`: durable queue, conversation timeline, and background worker.
- `src/server/automations`: schedule calculation and automation storage.
- `src/server/worker-plugin.ts`: starts the worker with Nitro, without needing an open browser.

Start supplies its default browser hydration and server request entrypoints.
There is no separate frontend server or custom backend bootstrap. Vite handles
local development; Nitro hosts the built Start application in production.

Route loaders read agents and connection status through Start server functions.
The create server function validates inputs and the chosen model before saving.
Node APIs and local credentials stay in server-only modules.

The generated route tree is checked in so typechecking works immediately after
installation. Start regenerates it during development and builds; do not edit it
by hand. It is excluded from formatting.

## Components and styling

Base UI means `@base-ui/react`. The button is adapted from
[shadcn/ui's Base UI registry](https://ui.shadcn.com/r/styles/base-nova/button.json)
and styled with StyleX. New components are locally owned source: adapt shadcn's
Base UI components and translate their styles to StyleX. Stock `shadcn add` is
not configured because it assumes Tailwind.

The StyleX Vite plugin runs before React and compiles styles for the client and
server builds. The root route links the emitted stylesheet so the server-rendered
page is styled before hydration.

## Codex boundary

Install the Codex CLI, then open **Settings → Connect Codex** in Roost. Copy the
one-time code and follow the OpenAI sign-in link. This works from a browser on
another machine; no SSH or localhost callback is needed. The login applies to
all agents on this Roost installation. You can also use `codex login` with
`cli_auth_credentials_store="file"` as the same operating-system user that runs Roost. `ROOST_CODEX_BINARY` optionally selects an alternate executable.
The installed executable determines which models appear. On this machine,
0.152.1 omits Astra while the app-bundled 0.153.4 includes it. To use the latter:

```sh
ROOST_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex corepack pnpm dev
```

The adapter starts `codex app-server --listen stdio://`, exchanges the
`initialize`/`initialized` handshake, reads account status, and paginates
`model/list`. Host discovery processes close after the operation. Each agent gets
its own Effect-managed app-server, reused while active and closed after ten idle
minutes so native background work has time to finish. Finished threads are
unsubscribed. No network listener is exposed by the app-server.

Connection request types were generated with codex-cli 0.152.1, and conversation
request types with 0.153.4. Soul tools and external token authentication use its
experimental protocol:

```sh
codex app-server generate-ts --experimental --out /tmp/roost-codex-protocol
```

Only the types used by the adapter and their imports are retained in
`src/server/codex/protocol`. Runtime response schemas validate the fields Roost
consumes. The tests exercise JSONL response correlation, disconnections, conversation
continuity, duplicate requests, and cancellation.

## Local persistence

Roost uses Node's built-in `node:sqlite`, with no ORM or database service.
`.roost/roost.sqlite` stores agent records. `.roost/workspaces/<agent-id>` is each
agent's directory. Set `ROOST_DATA_DIR` to choose another persistent directory;
back up the whole directory. `.roost` is ignored by Git.

Creating an agent is transactional and uses a stable request ID: retrying the
same request returns the saved agent, while reusing its ID with different
settings is rejected. The `agent_sessions` table maps each agent to its private
Codex thread and any archived chat from before memory isolation. The first
accepted turn establishes the mapping, because empty Codex threads cannot be
resumed after the app-server exits.

### Souls and memory

Open an agent's settings from the conversation header:

- **Soul** edits `.roost/agents/<agent-id>/SOUL.md`. New souls start from the
  agent's purpose and a small OpenClaw-inspired template covering character,
  voice, boundaries, and continuity. The soul is loaded explicitly on every
  send; it does not depend on memory retrieval. Changes take effect next turn.
  Saved threads receive a developer update with `thread/inject_items` when the
  soul changes, since resume overrides alone do not replace existing messages.
- Agents can use `roost_read_soul` and `roost_update_soul` to evolve their own
  soul. These tools are bound to the current agent and thread and accept no
  filesystem path. Other file writes remain disabled. The agent is instructed
  to make targeted edits for explicit lasting requests, and propose inferred
  changes before applying them. These authorization rules are prompt instructions;
  scheduled runs are additionally blocked from mutation tools by the server.
  Roost creates its own notice for every saved change, visible in both response
  styles. The Soul tab shows before/after history, source, reason, and Undo.
  Revision checks reject stale saves and undo attempts that would overwrite a
  newer change. Previous files also remain under `soul-history/<revision>.md`.
- **Memory** displays the agent's generated `memory_summary.md` and `MEMORY.md`
  when present. Native Codex memory generation and use are enabled. They are
  asynchronous and depend on Codex eligibility/idle-time rules; this is not
  instant recall after every reply. Roost's automation worker is separate from
  native memory generation.

Each agent has a separate `.roost/agents/<agent-id>/codex` home. Roost sets both
`CODEX_HOME` and `CODEX_SQLITE_HOME`, and pins `sqlite_home` so an inherited setting
cannot send its database writes to the host. Sessions, memory files, and memory
SQLite state stay there. Host memory, personal AGENTS.md, hooks, skills, and MCP
server configuration are not copied. Project instruction discovery is disabled;
the soul supplies the agent's instructions explicitly.

The operating-system user's Codex login is shared intentionally. Roost requires
file-based login credentials; for keyring-only setups run
`codex login -c cli_auth_credentials_store='"file"'`. With ChatGPT login, the host
owns refresh-token rotation and passes access tokens to isolated app-servers
using `chatgptAuthTokens`. Refresh tokens are not copied into agent homes.
First-party connected apps retain the host's app enablement/permission settings;
third-party MCP servers and plugins are not automatically imported.

Existing conversations migrate lazily on the next send. Their original rollouts
remain untouched. Roost archives displayable history in its database and gives
the new private thread up to 32,000 characters of recent user/assistant text for
continuity. Prior developer instructions, reasoning, and tool payloads are not
injected into the new session. Old shared memories are not imported, and copies
of legacy sessions already in the host's memory store are not deleted.

This is a **memory and session storage boundary**, not an OS security boundary:
read-only filesystem tools can still access files allowed by the host sandbox,
and connected apps use the same user's account. Roost instructs agents not to
read other agents' or host memory stores. Strong adversarial isolation would
require separate OS users/containers and connector credentials.

### Runs and automations

Agent settings → Automations supports creating, editing, pausing, resuming, and
running saved tasks. Agents expose the same operations through Roost dynamic
tools, so a direct request such as “check my inbox every weekday at 9am Pacific”
can create a schedule in chat. Schedules are structured data, never instructions
embedded in the soul. New tool versions migrate an existing chat into a fresh
native thread with archived visible history, because Codex cannot add dynamic
tools to a resumed thread.

Supported schedules are one-time timestamps with an explicit offset, minute
intervals, and selected weekdays at a local time in an IANA timezone. Weekly
schedules follow daylight saving time: missing local times are skipped, and a
repeated local minute runs once at its first occurrence. After downtime, missed
occurrences coalesce into one catch-up; no unbounded backlog is replayed.
Pausing or editing cancels queued occurrences. A running task continues until
explicitly stopped.

The Nitro worker starts with the Node server. SQLite records pending and active
runs, deduplicates occurrence/request IDs, and enforces one active run per agent.
A renewable worker lease prevents a second Roost process from claiming work.
Queued work survives restarts. In-flight work is marked interrupted on recovery
and is **not retried automatically**, since a tool may already have executed.
This is not an exactly-once guarantee for external tool side effects.

Scheduled runs use a fresh Codex thread with the saved task, current soul, and
same private agent memory. They do not receive the main chat history, and the
server rejects soul or automation mutations from them. Final results are posted
into the ongoing Roost conversation and supplied as quoted context on the next
chat turn. “Only when something needs attention” asks the agent for an exact
`ROOST_NO_UPDATE` final response when there is nothing to report; these successful
runs remain in history without a chat message. Failures are always visible.
This preference controls Roost chat messages, not operating-system notifications.

Run history includes status, task, output/tool activity, and the soul revision
used. Closing a browser never cancels a run. Stop cancels the selected queued or
active run. The worker requires **Roost and the machine to remain running**;
there is no cloud scheduler or wake-from-sleep service. Chat still uses a
read-only sandbox with approvals disabled and instructions limiting tools to
read-only operations, except Roost's explicit soul/automation tools. Scheduling
a task does not grant it new permissions.

The conversation uses shadcn Base UI Scroll Area and Collapsible composition,
styled with StyleX. Streaming follows the latest reply until you scroll up.
Thinking status appears once above the composer during generation; summaries are shown only when
Codex supplies them. Activity is shown as compact rows by default. Settings → Show activity details
enables expandable inputs, outputs, and thinking summaries. This display
preference is saved in browser storage and applies across agents.

## References

- [TanStack Start setup](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch)
- [TanStack Start Node hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nodejs--docker)
- [StyleX Vite setup](https://stylexjs.com/docs/learn/installation/vite/vite-react)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex memories](https://learn.chatgpt.com/docs/customization/memories)
- [OpenClaw soul template](https://docs.openclaw.ai/reference/templates/SOUL)
- [Roost design in Paper](https://app.paper.design/file/01M1SGGYR7NBNRDNV5601QMK3C/6-0)

`src/assets` contains the pixel logo and Moss, Wisp, and Peach characters from
Paper. Conversation components render live messages and tool activity.
