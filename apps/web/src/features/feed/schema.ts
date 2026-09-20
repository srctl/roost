import { Schema } from "effect";

const Text = (max: number) => Schema.Trim.pipe(Schema.maxLength(max));
const RequiredText = (max: number) => Text(max).pipe(Schema.minLength(1));
export function safeFeedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export const FeedUrl = RequiredText(2000).pipe(
  Schema.filter((url) => safeFeedUrl(url) !== null),
);
export const FeedSource = Schema.Struct({
  id: Schema.UUID,
  name: RequiredText(120),
  url: FeedUrl,
  enabled: Schema.Boolean,
});
export type FeedSource = typeof FeedSource.Type;
export const FeedSettingsWrite = Schema.Struct({
  revision: Schema.NonNegativeInt,
  enabled: Schema.Boolean,
  interests: Text(4000),
  priorities: Text(4000),
  agentId: Schema.NullOr(Schema.UUID),
  refreshMinutes: Schema.Int.pipe(Schema.between(30, 1440)),
  sources: Schema.Array(FeedSource).pipe(Schema.maxItems(20)),
  emailEnabled: Schema.Boolean,
  jevEnabled: Schema.Boolean,
  scorePrivateUpdates: Schema.Boolean,
  apiKey: Schema.optional(Text(1000)),
});
export type FeedSettingsWrite = typeof FeedSettingsWrite.Type;
export type FeedSettings = Omit<FeedSettingsWrite, "apiKey"> & {
  jevConfigured: boolean;
  jevKeySource: "environment" | "saved" | null;
};
export const FeedCitation = Schema.Struct({
  title: RequiredText(200),
  url: FeedUrl,
});
export const FeedPublication = Schema.Struct({
  requestId: Schema.UUID,
  key: RequiredText(300),
  kind: Schema.Literal("story", "update"),
  title: RequiredText(200),
  summary: RequiredText(1200),
  body: RequiredText(24000),
  url: Schema.optional(Schema.NullOr(FeedUrl)),
  sourceName: RequiredText(120),
  sourceUrl: Schema.optional(Schema.NullOr(FeedUrl)),
  imageUrl: Schema.optional(Schema.NullOr(FeedUrl)),
  topics: Schema.Array(RequiredText(80)).pipe(Schema.maxItems(8)),
  why: RequiredText(500),
  importance: Schema.Literal("normal", "important"),
  citations: Schema.Array(FeedCitation).pipe(Schema.maxItems(12)),
  candidateId: Schema.optional(Schema.UUID),
});
export type FeedPublication = typeof FeedPublication.Type;
export type FeedItem = {
  id: string;
  kind: "article" | "story" | "update";
  title: string;
  summary: string;
  body: string;
  url: string | null;
  imageUrl: string | null;
  sourceName: string;
  sourceUrl: string | null;
  authorAgentId: string | null;
  publishedAt: number;
  createdAt: number;
  readAt: number | null;
  saved: boolean;
  dismissed: boolean;
  topics: readonly string[];
  why: string;
  importance: "normal" | "important";
  score: number | null;
  scoring: "jev" | "basic" | "agent";
  citations: readonly (typeof FeedCitation.Type)[];
};
export const FeedQuery = Schema.Struct({
  filter: Schema.optional(Schema.Literal("all", "saved", "unread")),
  before: Schema.optional(Schema.NonNegativeInt),
});
export const FeedAction = Schema.Struct({
  id: Schema.UUID,
  action: Schema.Literal(
    "save",
    "unsave",
    "dismiss",
    "restore",
    "read",
    "unread",
    "more",
    "less",
  ),
});
export const FeedDiscussion = Schema.Struct({
  id: Schema.UUID,
  agentId: Schema.optional(Schema.UUID),
  requestId: Schema.UUID,
});
export type FeedStatus = {
  refreshing: boolean;
  lastRefreshedAt: number | null;
  lastError: string | null;
  scoring: "jev" | "basic" | "disabled";
};
export type FeedPage = {
  items: FeedItem[];
  nextCursor: number | null;
  settings: FeedSettings;
  status: FeedStatus;
};
