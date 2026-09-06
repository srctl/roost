import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence } from "../src/server/automations/schedule";
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
