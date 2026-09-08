# Automation schedules

Create or edit schedules in **Agent settings → Automations**, or ask the agent
in chat. One cron schedule can cover several times each day. Existing one-time,
interval, and weekday schedules continue to work.

Cron uses five fields: **minute hour day-of-month month day-of-week**.

| Expression       | Schedule                                        |
| ---------------- | ----------------------------------------------- |
| `0 8-22/2 * * *` | Every two hours, from 08:00 through 22:00 daily |
| `0 9,17 * * 1-5` | 09:00 and 17:00 on weekdays                     |
| `*/15 * * * *`   | Every 15 minutes                                |
| `0 9 1 * *`      | 09:00 on the first day of each month            |

Use an IANA timezone such as `America/Los_Angeles`. The form previews the next
three occurrences in that timezone. Cron evaluation uses the pinned Croner
library; Roost's durable queue remains responsible for execution, deduplication,
and catch-up. Croner follows timezone transitions, runs a repeated fixed hour
once, and may move a time in a spring-forward gap into the next valid hour.
Existing weekday schedules retain their behavior of skipping missing times.

Recurring schedules accept optional **start date** and **end date**. Both dates
are inclusive calendar dates in the schedule's timezone. Agent tools use
`startsOn` and `endsOn` in `YYYY-MM-DD` format. Omit either bound for no limit.
An interval with a future start date begins at midnight on that date; otherwise
its first run is one interval from now.

After the end date, the scheduler disables the automation and cancels queued
scheduled runs. It does not catch up expired work after downtime. A run already
underway may finish. **Run now** is an explicit manual invocation and works
outside the automatic date window. Editing cancels work queued under the old
settings; resuming requires a future occurrence inside the date window.

Existing automations are not automatically merged or given an end date. To
consolidate several daily checks, edit one to use a cron expression covering all
the intended times, then pause the redundant entries. Dates are optional; an
instruction such as “until delivered” is not a calendar end date.

## Managing saved work

Agent settings → Automations supports creating, editing, pausing, resuming,
running, and deleting saved tasks. Agents expose the same operations through
Roost tools, so a request such as “check my inbox every weekday at 9am Pacific”
can create a schedule in chat. Schedules are structured data, never instructions
embedded in the soul.

One-time timestamps require an explicit offset. Minute intervals and selected
weekdays at a local time in an IANA timezone are also supported. Weekday
schedules follow daylight saving time: missing local times are skipped, and a
repeated local minute runs once at its first occurrence. After downtime, missed
occurrences coalesce into one catch-up; no unbounded backlog is replayed. The
date bounds described above still apply.

Pausing or editing cancels queued occurrences. A running task continues until
explicitly stopped. Deleting an automation removes its schedule, cancels queued
runs, and requests cancellation of active runs. Past runs and their outputs stay
in history. The settings UI asks for confirmation before deletion; agents can
delete their own automations when explicitly asked in chat.

## Execution and recovery

The Nitro worker starts with the Node server. SQLite records pending and active
runs, deduplicates occurrence/request IDs, and enforces one active run per agent.
A renewable worker lease prevents a second Roost process from claiming work.
Queued work survives restarts. In-flight work is marked interrupted on recovery
and is **not retried automatically**, since a tool may already have executed.
This is not an exactly-once guarantee for external tool side effects.

## Context and quiet updates

Scheduled runs use a fresh Codex thread with the saved task, current soul, and
same private agent memory. They do not receive the main chat history, and the
server rejects soul or automation mutations from them.
[Periodic reflection](agents-and-memory.md#periodic-reflection) is a separate
run kind with limited permission to update its own soul. Final results are posted
into the ongoing Roost conversation and supplied as quoted context on the next
chat turn. “Only when something needs attention” asks the agent for an exact
`ROOST_NO_UPDATE` final response when there is nothing to report; these successful
runs remain in history without a chat message. Failures are always visible.
This preference also keeps successful no-update runs from sending push notifications.
Enable [push notifications](notifications.md) in Settings on each device.

## Run history and permissions

Run history includes status, task, output/tool activity, and the soul revision
used. Closing a browser never cancels a run. Stop cancels the selected queued or
active run. The worker requires **Roost and the machine to remain running**;
there is no cloud scheduler or wake-from-sleep service. Agents use a workspace-write
sandbox with native approvals enabled.
Agents can request additional filesystem access through native approvals;
external actions still require the user's authorization. A scheduled task grants
no additional permissions.
Pending approvals persist across browser closure and expire if the run stops
or the server restarts; interrupted work is not replayed automatically.

## Tool compatibility

New versions of Roost tools can migrate an existing chat into a fresh native
thread with archived visible history, because Codex cannot add dynamic tools
to a resumed thread. The agent keeps its private memory home.
