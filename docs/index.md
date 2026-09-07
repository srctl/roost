# Roost documentation

Roost gives your AI agents a place to keep working. Each agent has its own
purpose, conversation, files, and memory. You run Roost on your own host and
connect it to Codex.

## Start here

- [Choose a deployment platform](deployment.md) — start with exe.dev, or find the right path for your host.
- [Read with an agent](for-agents.md) — plain Markdown, llms.txt, and a deployment prompt.
- [Getting started](getting-started.md) — connect Codex and create your first agent.
- [Install and operate Roost](install.md) — Linux installation, private access,
  updates, and recovery.
- [Agents and memory](agents-and-memory.md) — shape an agent's behavior and
  understand what persists between conversations.

## Work with your agents

- [Automations](automations.md) — recurring work, timezones, quiet updates, and run history.
- [Delegation](delegation.md) — let agents hand a focused task to a specialist.
- [Files and approvals](files-and-approvals.md) — upload inputs, download results,
  and review actions that need your permission.
- [Dashboards](dashboards.md) — keep saved trackers, notes, and charts outside chat.
- [Shared computer](computer.md) — watch browser work and take control of the desktop.
- [Push notifications](notifications.md) — receive results and approval requests on your devices.
- [Mobile access](mobile.md) — add Roost to your home screen.

## Build and operate

- [Development](development.md) — run from source, contribution conventions, and packaging.
- [Public websites](public-sites.md) — build and host the marketing and documentation sites separately.
- [Architecture](architecture.md) — application structure, Codex integration, and storage.
- [Remote desktop setup](remote-desktop-setup.md) — provision a persistent Linux desktop.
- [Conversation performance](chat-performance.md) and [PWA startup](pwa-startup.md)
  — implementation notes and measured results.

## Deployment model

Roost is a single-user app. The packaged server listens on loopback and has no
application-level authentication. Use an SSH tunnel or a reverse proxy that
authenticates both HTTP and WebSocket connections. Its public marketing and
documentation sites can be hosted separately from this private app.

Work runs on the server, so closing a browser does not stop it. Roost and its
host must stay running for scheduled tasks and notifications. Agent memory and
sessions are stored separately, while the operating-system account, connected
accounts, and configured desktop are shared.
