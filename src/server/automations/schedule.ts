import type { Schedule } from "../../features/automations/schema";

// Weekly wall-clock schedules follow the selected IANA timezone across DST.
// On a repeated hour run once (the first occurrence); a missing local time is skipped.
export function nextOccurrence(
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
  if (schedule.kind === "once") return `Once · ${schedule.at}`;
  if (schedule.kind === "interval") return `Every ${schedule.minutes} minutes`;
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
