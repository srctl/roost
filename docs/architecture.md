# Architecture

Roost is one Node application with a React interface, SQLite persistence, and a
server-owned queue for agent work. Codex runs locally through its app-server
protocol.

## Application structure

- `src/router.tsx`: creates a fresh TanStack Router instance for each request.
- `src/routes/__root.tsx`: HTML document, metadata, stylesheet, and Start scripts.
- `src/routes/index.tsx`: the agent list and startup navigation.
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

## Codex integration

Roost uses a locally installed Codex executable, selected by `ROOST_CODEX_BINARY`
or the `codex` on PATH. Packaged releases select their bundled executable.
Authentication and available models are described in [Install and operate Roost](install.md#connect-codex).

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

For the packaged installation, the service sets `ROOST_DATA_DIR` to the `data`
directory inside `ROOST_HOME`; the default is `~/.local/share/roost/data`.

Agent soul history and native Codex memory are covered in
[Agents and memory](agents-and-memory.md). [Automations](automations.md) describes
worker recovery, scheduling, and execution guarantees, while
[Delegation](delegation.md) covers concurrency between agents.

## Conversation presentation

The conversation uses shadcn Base UI Scroll Area and Collapsible composition,
styled with StyleX. Streaming follows the latest reply until you scroll up.
Thinking status appears once above the composer during generation; summaries are
shown only when Codex supplies them. Activity is shown as compact rows by default.
Settings → Show activity details enables expandable inputs, outputs, and thinking
summaries. This display
preference is saved in browser storage and applies across agents.

The sidebar can be collapsed with its toggle. Conversation history is restored
from persisted state when you return. Leaving the page detaches the view; work
continues on the server until it completes or you stop it.

`src/assets` contains the pixel logo and Moss, Wisp, and Peach characters.
Conversation components render live messages and tool activity.

## References

- [TanStack Start setup](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch)
- [TanStack Start Node hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nodejs--docker)
- [StyleX Vite setup](https://stylexjs.com/docs/learn/installation/vite/vite-react)
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex memories](https://learn.chatgpt.com/docs/customization/memories)
- [OpenClaw soul template](https://docs.openclaw.ai/reference/templates/SOUL)
