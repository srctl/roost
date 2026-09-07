# Getting started

Create an agent with a clear job, then start a conversation. You can add
schedules, files, and a shared computer when the work needs them.

## 1. Open your Roost installation

Follow [Install and operate Roost](install.md) for a Linux x64 host with systemd.
The release bundle includes Node and Codex. Open the local address printed by
setup, or connect through the SSH tunnel in that guide.

For a source checkout, follow [Development](development.md). Source builds need
Node.js 22.13 or later, pnpm 9.15.0, and a separately installed Codex CLI.

Keep your app private. Roost has no application-level authentication; use
loopback, an SSH tunnel, or an authenticated reverse proxy for remote access.

## 2. Connect Codex

Open **Settings → Connect Codex**, copy the one-time device code, and follow the
OpenAI sign-in link. Enter the code to connect the installation. You can complete
sign-in from a different computer; no localhost callback or SSH login flow is
required.

The Codex login is shared by agents on this installation. Available models come
from the installed Codex executable and your account. If the connection expires,
use **Reconnect Codex**. The [installation guide](install.md) also covers terminal
sign-in.

## 3. Create an agent

Choose **Create an agent**. Pick a character, give your agent a name, describe
what it should help with, and choose an available model. For example:

> Research products I am considering. Compare practical tradeoffs, keep source
> links, and give a clear recommendation. Ask for my budget when it matters.

Press **Create agent**. This saves the agent and its workspace; it does not start
a task or schedule background work.

## 4. Send the first task

Open the agent's conversation and describe the result you want. Include the
context and constraints it needs. Attach files beside the composer if useful.

Replies and activity update live. **Stop** cancels the selected queued or active
run. You can close the browser and return later; server-owned work continues
while Roost and its host remain running. If the server restarts during a run,
that work is marked interrupted and is not automatically repeated.

When an action needs permission, a review card appears in the conversation.
Approve the exact prepared action or decline it. See [Files and approvals](files-and-approvals.md)
for supported inputs, downloads, and approval behavior.

## 5. Make it useful over time

- Open the agent's settings to edit its **Soul**: its purpose, voice, and lasting
  behavior. Changes take effect on its next turn. See [Agents and memory](agents-and-memory.md).
- Ask for a schedule, such as “Every weekday at 9am Pacific, check this project
  for changes and tell me only when something needs attention.” Review it in
  **Agent settings → Automations**. See [Automations](automations.md).
- Give another agent a specialist role, then ask an agent to delegate a focused
  task to it. See [Delegation](delegation.md).
- Enable **Settings → Dashboards** if you want saved trackers outside chat.
- Set up [notifications](notifications.md) on each device and
  [add Roost to your home screen](mobile.md) for phone access.

Browser control needs a separately configured Linux X11 desktop. Follow
[Shared computer](computer.md) when you want agents to work in a signed-in
browser you can watch and control.
