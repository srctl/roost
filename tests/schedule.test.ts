import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence } from "../src/server/automations/schedule";
import type { Schedule } from "../src/features/automations/schema";
const next = (time: string, days: number[], after: string) =>
  new Date(
    nextOccurrence(
      { kind: "weekly", time, days, timezone: "America/Los_Angeles" },
      Date.parse(after),
    )!,
  ).toISOString();
test("weekly schedules follow local time, skip a missing DST time, and run a repeated hour once", () => {
  assert.equal(
    next("09:00", [1, 2, 3, 4, 5], "2026-03-06T18:00:00Z"),
    "2026-03-09T16:00:00.000Z",
  );
  assert.equal(
    next("02:30", [0], "2026-03-08T09:59:00Z"),
    "2026-03-15T09:30:00.000Z",
  );
  assert.equal(
    next("01:30", [0], "2026-11-01T08:29:00Z"),
    "2026-11-01T08:30:00.000Z",
  );
  assert.equal(
    next("01:30", [0], "2026-11-01T08:30:00Z"),
    "2026-11-08T09:30:00.000Z",
  );
  assert.throws(
    () => nextOccurrence({ kind: "once", at: "2026-09-06T09:00" }, 0),
    /offset/,
  );
  assert.equal(
    nextOccurrence(
      { kind: "once", at: "2026-09-06T09:00:00Z" },
      Date.parse("2026-09-07T09:00:00Z"),
    ),
    null,
  );
  assert.throws(() =>
    nextOccurrence(
      { kind: "weekly", days: [1], time: "09:00", timezone: "Invalid/Zone" },
      Date.now(),
    ),
  );
});

test("one cron schedule covers a daily time window within inclusive local dates", () => {
  const schedule: Schedule = {
    kind: "cron",
    expression: "0 8-22/2 * * *",
    timezone: "America/Los_Angeles",
    startsOn: "2026-09-06",
    endsOn: "2026-09-06",
  };
  let after = Date.parse("2026-09-01T00:00:00Z");
  const runs: string[] = [];
  for (;;) {
    const at = nextOccurrence(schedule, after);
    if (at === null) break;
    runs.push(new Date(at).toISOString());
    after = at;
  }
  assert.deepEqual(runs, [
    "2026-09-06T15:00:00.000Z",
    "2026-09-06T17:00:00.000Z",
    "2026-09-06T19:00:00.000Z",
    "2026-09-06T21:00:00.000Z",
    "2026-09-06T23:00:00.000Z",
    "2026-09-07T01:00:00.000Z",
    "2026-09-07T03:00:00.000Z",
    "2026-09-07T05:00:00.000Z",
  ]);
  assert.equal(
    nextOccurrence(
      { ...schedule, expression: "0 0 * * *" },
      Date.parse("2026-09-01T00:00:00Z"),
    ),
    Date.parse("2026-09-06T07:00:00Z"),
  );
  assert.equal(
    nextOccurrence(schedule, Date.parse("2026-09-07T07:00:00Z")),
    null,
  );
});

test("cron handles calendar expressions and DST without duplicate runs; invalid schedules fail", () => {
  const schedule: Schedule = {
    kind: "cron",
    expression: "30 1 * * SUN",
    timezone: "America/Los_Angeles",
  };
  assert.equal(
    nextOccurrence(schedule, Date.parse("2026-11-01T08:30:00Z")),
    Date.parse("2026-11-08T09:30:00Z"),
  );
  assert.equal(
    nextOccurrence(
      { ...schedule, expression: "15 9 1,15 * *" },
      Date.parse("2026-09-02T00:00:00Z"),
    ),
    Date.parse("2026-09-15T16:15:00Z"),
  );
  for (const expression of [
    "* * * * * *",
    "75 * * * *",
    "not cron",
    "2026-09-06T12:00:00Z",
  ]) {
    assert.throws(() =>
      nextOccurrence(
        { ...schedule, expression },
        Date.parse("2026-09-01T00:00:00Z"),
      ),
    );
  }
  assert.throws(
    () => nextOccurrence({ ...schedule, startsOn: "2026-02-30" }, 0),
    /valid start/,
  );
  assert.throws(
    () =>
      nextOccurrence(
        { ...schedule, startsOn: "2026-09-07", endsOn: "2026-09-06" },
        0,
      ),
    /on or after/,
  );
  assert.equal(
    nextOccurrence(
      {
        ...schedule,
        expression: "0 9 * * 1",
        startsOn: "2026-09-06",
        endsOn: "2026-09-06",
      },
      0,
    ),
    null,
  );
});

test("date windows also bound weekly and interval schedules", () => {
  const dates = {
    timezone: "America/Los_Angeles",
    startsOn: "2026-09-06",
    endsOn: "2026-09-06",
  };
  assert.equal(
    nextOccurrence(
      { kind: "weekly", time: "00:00", days: [0], ...dates },
      Date.parse("2026-09-05T00:00:00Z"),
    ),
    Date.parse("2026-09-06T07:00:00Z"),
  );
  assert.equal(
    nextOccurrence(
      { kind: "interval", minutes: 60, ...dates },
      Date.parse("2026-09-05T00:00:00Z"),
    ),
    Date.parse("2026-09-06T07:00:00Z"),
  );
  assert.equal(
    nextOccurrence(
      { kind: "interval", minutes: 60, ...dates },
      Date.parse("2026-09-07T06:30:00Z"),
    ),
    null,
  );
});
