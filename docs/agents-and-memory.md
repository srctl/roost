# Agents and memory

Each Roost agent has its own purpose, ongoing conversation, workspace, and
Codex memory. Give agents clear responsibilities so you know where to return
for a piece of work. You can assign focused work between them with
[delegation](delegation.md).

An agent's **soul** defines how it should behave: its purpose, voice, and
boundaries. **Memory** holds context it has learned. Editing the soul changes
its ongoing instructions; starting a schedule is a separate action.

## Soul and memory settings

Open an agent's settings from the conversation header:

- **Soul** edits `.roost/agents/<agent-id>/SOUL.md`. New souls start from the
  agent's purpose and a small OpenClaw-inspired template covering character,
  voice, boundaries, and continuity. The soul is loaded explicitly on every
  send; it does not depend on memory retrieval. Changes take effect next turn.
  Saved threads receive a developer update with `thread/inject_items` when the
  soul changes, since resume overrides alone do not replace existing messages.
- Agents can use `roost_read_soul` and `roost_update_soul` to evolve their own
  soul. These tools are bound to the current agent and thread and accept no
  filesystem path. Workspace files can be created and edited for the user's task.
  The agent is instructed
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

## What stays separate

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

## Data and backups

Paths above are relative to the data directory (`.roost` for a source checkout).
The installed service uses `~/.local/share/roost/data` by default. Back up the
whole data directory to retain conversations, uploads, downloads, souls, and
Codex memory together. See [Install and operate Roost](install.md) for updates
and recovery.
