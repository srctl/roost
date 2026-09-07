# Files and approvals

Use **Attach files** beside the composer to send up to five files per message,
20 MB each. You can also paste screenshots or copied images directly into the
message box with **Cmd+V**, **Ctrl+V**, or the device's **Paste** command. Pasted
images appear as attachments for you to review before sending; ordinary text
paste still works. Text is optional when files are attached. Remove a file from the
draft before sending to leave it out. A failed send keeps the draft; check the
conversation before retrying if the server may have received it.

Images are passed to Codex as image inputs. Documents are supplied as local file
paths that the agent can read with its available tools. Reading a format such as
PDF or a spreadsheet still depends on tools installed on the server; uploading
does not install document software. Uploads are kept as immutable originals
outside the agent workspace.

Agents may create and edit files in their own workspace. Ask for a report,
spreadsheet, or edited document; the agent calls `roost_publish_artifact` to add
a download to the conversation. Downloads are immutable snapshots, so subsequent
workspace edits do not change an already delivered file. Publishing rejects
paths outside that agent's workspace and symbolic links. Files use the same
protected Roost HTTP access as conversations, and are never cached by the PWA.
Back up the entire data directory to retain uploads and downloads.

## Approve prepared work

When an action needs your permission, the agent can call
`roost_request_approval` with the exact action, destination, and proposed content
or cost. A card appears above the composer. Choose **Approve once** or **Decline**;
the waiting tool receives your decision and the agent continues. The request and
decision remain available from a notice in conversation history. Approving a
request grants only that described action, and changed details require another
decision. Requests already authorized by the user do not need another prompt.

Native Codex command/file approvals and app choice prompts also appear here.
Only one-time grants are offered. Commands show the command, directory, and any
requested network or additional permissions; file requests show the proposed
changes. Requests without a reviewable action are declined. Simple MCP consent
forms are supported; rich MCP forms, secret inputs, and sign-in URL elicitations
are not. Use the computer viewer for passwords, MFA, and sign-ins.

Approvals keep waiting on the server if you close the browser. Enable
[push notifications](notifications.md) to be notified on your device. Notifications
contain no action details and never approve anything. The computer is released
while approval is pending, allowing other agents to use it; after resuming, the
agent must inspect the current screen again before acting.

Stop cancels the waiting request. Server restart, run completion, or a cleared
Codex request expires any unanswered approval. Decisions for expired requests,
another agent, or a changed action are rejected. In-flight actions are not
automatically retried after restart. A waiting approval occupies the agent's
current run slot; other agents can continue within the worker's concurrency limit.

The workspace sandbox enforces filesystem limits. The semantic meaning of an
approval for a browser action (for example, matching checkout details) is enforced
by agent instructions; Roost does not recognize every button on third-party sites.
