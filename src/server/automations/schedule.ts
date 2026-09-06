import type { Schedule } from "../../features/automations/schema";
import { Cron, CronDate } from "croner";

// Calendar dates include the whole day in the schedule's timezone.
export function scheduleWindow(schedule: Schedule) {
  const timezone =
    schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  if (schedule.kind === "once") return { start: -Infinity, end: Infinity };
  for (const date of [schedule.startsOn, schedule.endsOn]) {
    if (
      date !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new Error("Choose valid start and end dates.");
  }
  if (
    schedule.startsOn &&
    schedule.endsOn &&
    schedule.startsOn > schedule.endsOn
  )
    throw new Error("The end date must be on or after the start date.");
  return {
    start: schedule.startsOn
      ? new CronDate(`${schedule.startsOn}T00:00:00`, timezone)
          .getDate()
          .getTime()
      : -Infinity,
    end: schedule.endsOn
      ? new CronDate(`${schedule.endsOn}T23:59:59`, timezone)
          .getDate()
          .getTime() + 999
      : Infinity,
  };
}

export function nextOccurrence(
  schedule: Schedule,
  after: number,
): number | null {
  const { start, end } = scheduleWindow(schedule);
  if (after >= end) return null;
  const next =
    schedule.kind === "interval" && after < start
      ? start
      : nextUnboundedOccurrence(schedule, Math.max(after, start - 1));
  return next !== null && next <= end ? next : null;
}

// Weekly wall-clock schedules follow the selected IANA timezone across DST.
// On a repeated hour run once (the first occurrence); a missing local time is skipped.
function nextUnboundedOccurrence(
  schedule: Schedule,
  after: number,
): number | null {
  if (schedule.kind === "once") {
    const at = Date.parse(schedule.at);
    if (!Number.isFinite(at) || !/(Z|[+-]\d\d:\d\d)$/.test(schedule.at))
      throw new Error("Choose a date with a timezone offset.");
    return at > after ? at : null;
  }
  if (schedule.kind === "interval") return after + schedule.minutes * 60000;
  if (schedule.kind === "cron") {
    if (schedule.expression.trim().split(/\s+/).length !== 5)
      throw new Error(
        "Use five cron fields: minute hour day-of-month month day-of-week.",
      );
    const cron = new Cron(schedule.expression, {
      timezone: schedule.timezone,
      mode: "5-part",
    });
    return cron.nextRun(new Date(after))?.getTime() ?? null;
  }
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: schedule.timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (time: number) =>
    Object.fromEntries(
      format.formatToParts(time).map((part) => [part.type, part.value]),
    );
  const [hour, minute] = schedule.time.split(":");
  for (
    let time = Math.floor(after / 60000) * 60000 + 60000;
    time <= after + 9 * 86400000;
    time += 60000
  ) {
    const p = parts(time);
    if (
      p.hour !== hour ||
      p.minute !== minute ||
      !schedule.days.includes(
        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday!),
      )
    )
      continue;
    // An offset transition can repeat the same local minute. Don't run it twice.
    let repeated = false;
    for (let offset = 1; offset <= 180; offset++) {
      const earlier = parts(time - offset * 60000);
      if (
        ["year", "month", "day", "hour", "minute"].every(
          (key) => earlier[key] === p[key],
        )
      ) {
        repeated = true;
        break;
      }
    }
    if (!repeated) return time;
  }
  throw new Error("Could not find the next scheduled time.");
}

export function scheduleLabel(schedule: Schedule) {
  const label = recurrenceLabel(schedule);
  if (schedule.kind === "once") return label;
  const dates = [
    schedule.startsOn && `From ${schedule.startsOn}`,
    schedule.endsOn && `Through ${schedule.endsOn}`,
  ].filter(Boolean);
  return [label, ...dates].join(" · ");
}

function recurrenceLabel(schedule: Schedule) {
  if (schedule.kind === "once") return `Once · ${schedule.at}`;
  if (schedule.kind === "interval")
    return `Every ${schedule.minutes} minutes${schedule.timezone ? ` · ${schedule.timezone}` : ""}`;
  if (schedule.kind === "cron")
    return `${schedule.expression} · ${schedule.timezone}`;
  const days = [...new Set(schedule.days)].sort();
  const label =
    days.length === 7
      ? "Every day"
      : days.join() === "1,2,3,4,5"
        ? "Weekdays"
        : days
            .map(
              (day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day],
            )
            .join(", ");
  return `${label} at ${schedule.time} · ${schedule.timezone}`;
}
