# Deleting an agent

## Lifecycle decision (recorded before implementation)

Agent ownership is recorded in `roost.sqlite`; agent workspaces and Codex homes
are separate directories. Herdr coding jobs can operate on external machines and
repositories. There are no cascading foreign keys or existing agent deletion API.

Deletion permanently removes the agent from Roost, including its conversation
and run history, soul change records, automations, reflection settings,
dashboards/datasets, notifications, approvals, file metadata, coding configuration,
and coding job records. Queued work is discarded in the same transaction.
There is no undo or automatic recovery. A minimal ID/time tombstone is retained
indefinitely to reject stale creation retries and late database writes.

Disk data is retained indefinitely: `agents/<id>` (soul, soul history, Codex
sessions and memory), `workspaces/<id>`, and `files/<id>` attachment/artifact bytes. Ownership
of workspace content and repositories is uncertain; deletion is not a secure
erasure feature. These files are no longer accessible through that agent in
Roost. Backups and provider-side history are unchanged. Administrative recovery
or cleanup is outside this feature; retained files alone do not restore app state.
Thread-indexed database metadata is retained conservatively because legacy
threads can be shared. Shared execution profiles, global settings, subscriptions,
other agents, external repositories, worktrees, terminals and infrastructure are
preserved.

An active/steering conversation blocks deletion; stop it using existing controls
and wait for its terminal outcome, then retry. Coding jobs block deletion unless
never launched, completed, or confirmed cancelled. Failed/ambiguous launches and
blocked/review workers require inspection and a confirmed stop or completion.
Deletion sends no shell commands or interrupts and never equates a stop request
with a stopped worker. Outstanding delegated work involving this agent also
blocks deletion until it settles, preserving other agents' work. Historical
handoff messages already copied into other conversations remain there.

Checks and removal hold the SQLite write lock together. A concurrent claim or
submission either commits first and blocks deletion, or loses to deletion and
cannot recreate agent-owned rows. Successful deletion navigates Home and reloads
the agent list. A failed request keeps the confirmation open for inspection/retry.

## Runtime and recovery limits

Roost's normal deployment runs one server/worker process for a data directory.
Deletion closes that process's idle per-agent Codex runtime (including native
memory work) before committing. A busy runtime refuses deletion. Active job
checks use persistent SQLite state; deletion does not attempt distributed
termination of another Roost installation or manually restarted external
terminals. Stopped external sessions remain available for manual inspection.
The feature never deletes worktrees or revokes provider credentials.

The schema advances from 10 to 11. Older Roost binaries refuse the newer schema;
use a pre-upgrade backup for a downgrade. Tombstones must be preserved when
migrating data to keep old creation requests from recreating deleted identities.
