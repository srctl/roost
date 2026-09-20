import type { FeedItem } from "./schema";

export type FeedTimeGroup = {
  id: string;
  label: string;
  items: FeedItem[];
};

type LocalDate = {
  key: string;
  year: number;
  ordinal: number;
  hour: number;
};

function localDate(
  timestamp: number,
  formatter: Intl.DateTimeFormat,
): LocalDate {
  const parts = formatter.formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return {
    key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    year,
    // Compare local calendar dates, not elapsed 24-hour intervals across DST.
    ordinal: Date.UTC(year, month - 1, day) / 86_400_000,
    hour: value("hour"),
  };
}

export function groupFeedItems(
  items: readonly FeedItem[],
  options: { now: number; timeZone: string; locale?: string },
): FeedTimeGroup[] {
  const { now, timeZone, locale = "en-US" } = options;
  const calendar = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const today = localDate(now, calendar);
  const dateOptions: Intl.DateTimeFormatOptions = {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  };
  const withinYear = new Intl.DateTimeFormat(locale, dateOptions);
  const otherYear = new Intl.DateTimeFormat(locale, {
    ...dateOptions,
    year: "numeric",
  });
  const groups = new Map<string, FeedTimeGroup>();
  const sorted = [...items].sort(
    (left, right) =>
      right.publishedAt - left.publishedAt ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  for (const item of sorted) {
    const reported = localDate(item.publishedAt, calendar);
    let id = reported.key;
    let label: string;
    if (reported.ordinal === today.ordinal) {
      const period =
        reported.hour < 12
          ? "morning"
          : reported.hour < 17
            ? "afternoon"
            : "evening";
      id += `:${period}`;
      label = `This ${period}`;
    } else if (reported.ordinal === today.ordinal - 1) {
      label = "Yesterday";
    } else {
      label = (reported.year === today.year ? withinYear : otherYear).format(
        item.publishedAt,
      );
    }
    const existing = groups.get(id);
    if (existing) existing.items.push(item);
    else groups.set(id, { id, label, items: [item] });
  }
  return [...groups.values()];
}

export function feedReportedTime(
  timestamp: number,
  timeZone: string,
  locale = "en-US",
): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
