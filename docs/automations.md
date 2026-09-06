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
