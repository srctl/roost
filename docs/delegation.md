# Agent delegation

Agents can hand parts of a user request to other agents without holding their
own conversation open. Give each specialist a clear responsibility when creating
it; the orchestrator discovers those descriptions with `roost_list_agents`.
For example, tell Guy to ask your shopping agent to research a purchase. Guy
queues the task, finishes his handoff reply, and remains available for questions.

`roost_delegate_task` takes a target `agentId`, a self-contained `task`, and a
stable `requestId` UUID. Repeating the same request does not run it twice.
Specialists receive only the supplied brief, their own soul, and their own memory.
Each assignment starts a separate task thread. Its messages appear in the
specialist's conversation, with a link back to the assigning agent.

Roost runs up to four agents concurrently and one turn at a time per agent.
At most three background tasks run together, leaving a slot for user conversations.
When a specialist finishes, fails, is stopped, or is interrupted by a restart,
the durable scheduler queues one result turn for the originating agent. That
turn uses the originating agent's conversation and produces a user-facing update.
An active user turn finishes first, and queued user messages take priority.
Interrupted work is reported, never automatically repeated. Stopping a result
update does not undo the specialist's work. Stop a delegated task by opening the
specialist and stopping its current/queued run.

The sidebar shows a small animated pixel sparkle while an agent works, and a
muted sparkle while it is queued or waiting on a specialist. Hover or an
accessible label identifies the state. Reduced-motion preferences stop animation.
Status refreshes every two seconds while Roost is visible.

This first version supports one level of delegation: user chat turns can assign
tasks; specialists, automated runs, and result updates cannot delegate further.
Each originating agent may have at most twelve outstanding tasks. These bounds
prevent unattended chains of agents waking each other indefinitely. Use
`roost_list_delegations` for a requested status check; results arrive automatically.

All agents still share one computer and signed-in browser. The desktop belongs
to one agent until its run ends. Another agent's initial screenshot waits for
ownership; stale clicks and keystrokes are rejected instead of replayed. Taking
human control blocks all agent computer actions. Cancelling a waiting task
cancels its pending screenshot.

Delegation does not expand authority. A specialist can pause with an approval request in its own conversation;
the user can answer there or follow its push notification. An agent's brief or
webpage never counts as user approval. Souls and automations cannot be changed by
delegated tasks or result updates. Separate desktops and browser profiles are
not part of this release.
