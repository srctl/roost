# Roost

**A home for persistent AI agents and their work.**

Roost is a self-hosted app for agents with a purpose, a conversation, and work to
come back to. Connect Codex, create your agents, and give each one a job. Talk
with them, schedule recurring tasks, and pick up where you left off from your
computer or phone.

## What you can do

- **Give every agent a role.** Choose a name, character, model, and instructions.
  Each agent keeps its own conversation, workspace, soul, and Codex memory.
- **Keep work moving.** Schedule checks and recurring tasks, or let an agent
  delegate part of your request to a specialist. Work continues when you close
  the browser, while Roost and its host remain running.
- **Work with files.** Attach documents and images, receive downloadable results,
  and approve prepared actions in the conversation.
- **Share a computer.** On a configured Linux desktop, watch an agent use the
  signed-in browser and take control when you need to.
- **Keep useful results nearby.** Enable agent-maintained dashboards for notes,
  tables, charts, and task lists. Add Roost to your phone's home screen and enable
  push notifications for results or approvals.

Roost is built for one person running their own agents. Conversations, settings,
files, and agent memory are stored on your host. Agents use Codex and any
connected services to do their work; this is not an offline model runner.

## Get started

The packaged installation supports **Linux x64 with systemd** and includes its
own Node and Codex runtimes.

1. Follow the [installation guide](docs/install.md) to install a release and open
   Roost through a local connection or SSH tunnel.
2. Open **Settings → Connect Codex** and complete sign-in.
3. Choose **Create an agent**, give it a purpose, and send your first task.

The [getting started guide](docs/getting-started.md) walks through your first
agent. For other platforms or a source checkout, see [development](docs/development.md).

Choose a host in the [deployment guide](docs/deployment.md), including exe.dev,
Linux servers, macOS, Railway, and Vercel for the public websites. Working with
an agent? Start with [agent-readable docs](docs/for-agents.md); the published
docs site provides `/llms.txt`, `/llms-full.txt`, and a Markdown URL for every guide.

Roost currently has no application-level authentication. Keep the app on loopback
with SSH access, or behind a proxy that authenticates HTTP and WebSocket traffic.
Agent memory is kept separately, but agents share the host and connected
accounts; they are not isolated operating-system users.

## Learn more

- [Documentation](docs/index.md)
- [Agents and memory](docs/agents-and-memory.md)
- [Automations](docs/automations.md) and [delegation](docs/delegation.md)
- [Files and approvals](docs/files-and-approvals.md)
- [Shared computer](docs/computer.md), [dashboards](docs/dashboards.md), and [mobile access](docs/mobile.md)
- [Development](docs/development.md) and [architecture](docs/architecture.md)

Source and releases: [srctl/roost on GitHub](https://github.com/srctl/roost).
Roost is available under the [MIT license](LICENSE).
