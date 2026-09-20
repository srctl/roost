import assert from "node:assert/strict";
import { test } from "node:test";
import {
  feedReportedTime,
  groupFeedItems,
} from "../src/features/feed/grouping";
import type { FeedItem } from "../src/features/feed/schema";

const timestamp = (value: string) => Date.parse(value);
const timeZone = "America/Los_Angeles";
const story = (id: string, published: string, createdAt = 0): FeedItem => ({
  id,
  kind: "article",
  title: id,
  summary: "A neighborhood report.",
  body: "The report body.",
  url: "https://example.com/report",
  imageUrl: null,
  sourceName: "Local news",
  sourceUrl: "https://example.com",
  authorAgentId: null,
  publishedAt: timestamp(published),
  createdAt,
  readAt: null,
  saved: false,
  dismissed: false,
  topics: [],
  why: "From a publication you follow.",
  importance: "normal",
  score: null,
  scoring: "basic",
  citations: [],
});

test("feed sections use local noon and 5 PM boundaries in report-time order", () => {
  const items = [
    story("late-morning", "2026-09-20T11:59:59-07:00"),
    story("midnight", "2026-09-20T00:00:00-07:00"),
    story("late-afternoon", "2026-09-20T16:59:59-07:00"),
    story("noon", "2026-09-20T12:00:00-07:00"),
    story("evening", "2026-09-20T17:00:00-07:00"),
  ];
  const groups = groupFeedItems(items, {
    now: timestamp("2026-09-20T23:00:00-07:00"),
    timeZone,
  });
  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.id)]),
    [
      ["This evening", ["evening"]],
      ["This afternoon", ["late-afternoon", "noon"]],
      ["This morning", ["late-morning", "midnight"]],
    ],
  );
});

test("local midnight changes yesterday independently of the UTC date", () => {
  const items = [
    story("last-night", "2026-09-20T06:59:59Z"),
    story("today", "2026-09-20T07:00:00Z"),
  ];
  const now = timestamp("2026-09-20T07:01:00Z");
  assert.deepEqual(
    groupFeedItems(items, { now, timeZone }).map((group) => [
      group.label,
      group.items.map((item) => item.id),
    ]),
    [
      ["This morning", ["today"]],
      ["Yesterday", ["last-night"]],
    ],
  );
  assert.deepEqual(
    groupFeedItems(items, { now, timeZone: "Asia/Tokyo" }).map((group) => [
      group.label,
      group.items.map((item) => item.id),
    ]),
    [["This afternoon", ["today", "last-night"]]],
  );
});

test("yesterday is a calendar day across the 23-hour spring-forward day", () => {
  const groups = groupFeedItems(
    [
      story("spring-start", "2026-03-08T00:10:00-08:00"),
      story("day-before", "2026-03-07T23:50:00-08:00"),
      story("spring-end", "2026-03-08T23:50:00-07:00"),
    ],
    { now: timestamp("2026-03-09T00:05:00-07:00"), timeZone },
  );
  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.id)]),
    [
      ["Yesterday", ["spring-end", "spring-start"]],
      ["Saturday, Mar 7", ["day-before"]],
    ],
  );
});

test("yesterday includes both repeated hours on the 25-hour fall-back day", () => {
  const groups = groupFeedItems(
    [
      story("first-one-thirty", "2026-11-01T01:30:00-07:00"),
      story("second-one-thirty", "2026-11-01T01:30:00-08:00"),
      story("fall-start", "2026-11-01T00:05:00-07:00"),
    ],
    { now: timestamp("2026-11-02T00:10:00-08:00"), timeZone },
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.label, "Yesterday");
  assert.deepEqual(
    groups[0]?.items.map((item) => item.id),
    ["second-one-thirty", "first-one-thirty", "fall-start"],
  );
});

test("older sections use local dates and include the year only when different", () => {
  const groups = groupFeedItems(
    [
      story("prior-year", "2026-01-01T07:30:00Z"),
      story("same-year", "2026-01-01T08:30:00Z"),
      story("yesterday", "2026-01-02T22:00:00-08:00"),
    ],
    { now: timestamp("2026-01-03T12:00:00-08:00"), timeZone },
  );
  assert.deepEqual(
    groups.map((group) => [group.id, group.label]),
    [
      ["2026-01-02", "Yesterday"],
      ["2026-01-01", "Thursday, Jan 1"],
      ["2025-12-31", "Wednesday, Dec 31, 2025"],
    ],
  );
});

test("grouping sorts reported time with deterministic ID ties without mutating input", () => {
  const items = Object.freeze([
    Object.freeze(story("z", "2026-09-20T10:00:00-07:00", 999_999)),
    Object.freeze(story("older", "2026-09-20T09:00:00-07:00", 2_000_000)),
    Object.freeze(story("a", "2026-09-20T10:00:00-07:00", 0)),
  ]);
  const options = { now: timestamp("2026-09-20T18:00:00-07:00"), timeZone };
  assert.deepEqual(
    groupFeedItems(items, options).flatMap((group) =>
      group.items.map((item) => item.id),
    ),
    ["a", "z", "older"],
  );
  assert.deepEqual(
    items.map((item) => item.id),
    ["z", "older", "a"],
  );
  assert.deepEqual(groupFeedItems([], options), []);
});

test("reported source time shows the supplied local month, day, hour and minute", () => {
  const reported = timestamp("2026-09-20T00:05:00Z");
  assert.equal(feedReportedTime(reported, timeZone), "Sep 19, 5:05 PM");
  assert.equal(feedReportedTime(reported, "Asia/Tokyo"), "Sep 20, 9:05 AM");
  assert.equal(
    feedReportedTime(reported, "Europe/London", "en-GB"),
    "20 Sept, 1:05",
  );
});
