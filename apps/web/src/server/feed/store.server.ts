import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Effect, Schema } from "effect";
import {
  FeedAction,
  type FeedItem,
  type FeedPage,
  FeedPublication,
  FeedQuery,
  type FeedSettings,
  FeedSettingsWrite,
  type FeedStatus,
} from "../../features/feed/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { writeTransaction } from "../transaction.server";

export const feedHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const DEFAULT_FEED_SETTINGS: Omit<
  FeedSettings,
  "jevConfigured" | "jevKeySource"
> = {
  revision: 0,
  enabled: false,
  interests:
    "Seattle and Capitol Hill: neighborhood news, local events, food, culture, and changes that affect daily life.",
  priorities: "",
  agentId: null,
  refreshMinutes: 180,
  sources: [
    {
      id: "21a2e250-0f81-45ac-9163-3f7ba01bbcce",
      name: "Capitol Hill Seattle Blog",
      url: "https://www.capitolhillseattle.com/feed/",
      enabled: true,
    },
    {
      id: "306d7a24-4c9d-4484-86b0-0037a85a433b",
      name: "The Seattle Times · Local",
      url: "https://www.seattletimes.com/seattle-news/feed/",
      enabled: true,
    },
  ],
  emailEnabled: false,
  jevEnabled: false,
  scorePrivateUpdates: false,
};

function keyPath(root: string) {
  return join(root, "secrets", "feed-jev-key");
}
export function feedApiKey(
  root = resolve(process.env.ROOST_DATA_DIR ?? ".roost"),
) {
  const environment =
    process.env.ROOST_JEV_API_KEY?.trim() ||
    process.env.TYPESAFE_API_KEY?.trim();
  if (environment) return { key: environment, source: "environment" as const };
  if (existsSync(keyPath(root))) {
    const key = readFileSync(keyPath(root), "utf8").trim();
    if (key) return { key, source: "saved" as const };
  }
  return { key: null, source: null };
}
function saveKey(root: string, value: string) {
  if (!value) {
    rmSync(keyPath(root), { force: true });
    return;
  }
  const directory = join(root, "secrets");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = join(directory, `feed-jev-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
    renameSync(temporary, keyPath(root));
  } finally {
    rmSync(temporary, { force: true });
  }
}
export function readFeedSettings(db: DatabaseSync, root: string): FeedSettings {
  const row = db
    .prepare("SELECT value,revision FROM feed_settings WHERE id=1")
    .get();
  const settings = row
    ? { ...JSON.parse(String(row.value)), revision: Number(row.revision) }
    : DEFAULT_FEED_SETTINGS;
  const key = feedApiKey(root);
  return { ...settings, jevConfigured: !!key.key, jevKeySource: key.source };
}
export function readFeedStatus(db: DatabaseSync, root: string): FeedStatus {
  const row = db.prepare("SELECT * FROM feed_refresh WHERE id=1").get()!;
  const settings = readFeedSettings(db, root);
  const run = row.curationRunId
    ? db
        .prepare("SELECT status,error,messages FROM runs WHERE id=?")
        .get(String(row.curationRunId))
    : null;
  const editorReportedProblem =
    run?.status === "completed" &&
    (() => {
      const messages = JSON.parse(String(run.messages ?? "[]")) as {
        role?: string;
        text?: string;
      }[];
      const answer = [...messages]
        .reverse()
        .find((message) => message.role === "assistant")
        ?.text?.trim();
      return !!answer && answer !== "ROOST_NO_UPDATE";
    })();
  return {
    refreshing:
      (settings.enabled && !!row.requested) ||
      (!!row.owner && Number(row.leaseUntil) > Date.now()) ||
      run?.status === "queued" ||
      run?.status === "running",
    lastRefreshedAt:
      row.lastRefreshedAt === null ? null : Number(row.lastRefreshedAt),
    lastError: row.lastError
      ? String(row.lastError)
      : run &&
          (["failed", "interrupted"].includes(String(run.status)) ||
            editorReportedProblem)
        ? "The feed editor could not finish. Check its run history and try again."
        : null,
    scoring: !settings.enabled
      ? "disabled"
      : settings.jevEnabled && settings.jevConfigured
        ? "jev"
        : "basic",
  };
}
export const getFeedSettings = () =>
  withAgentStore((db, root) => readFeedSettings(db, root));
export const getFeedStatus = () =>
  withAgentStore((db, root) => readFeedStatus(db, root));
export const saveFeedSettings = (input: FeedSettingsWrite) =>
  withAgentStore((db, root) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const parsed = Schema.decodeUnknownSync(FeedSettingsWrite)(input);
      const current = readFeedSettings(db, root);
      if (current.revision !== parsed.revision)
        throw new AgentStoreError({
          message: "Feed preferences changed elsewhere. Reload before saving.",
        });
      if (parsed.agentId) requireAgent(db, parsed.agentId);
      if (parsed.emailEnabled && !parsed.agentId)
        throw new AgentStoreError({
          message: "Choose an agent before enabling email updates.",
        });
      if (
        new Set(parsed.sources.map((source) => source.id)).size !==
          parsed.sources.length ||
        new Set(parsed.sources.map((source) => source.url)).size !==
          parsed.sources.length
      )
        throw new AgentStoreError({
          message: "Each feed source must have a unique URL and ID.",
        });
      const configured =
        parsed.apiKey !== undefined
          ? !!parsed.apiKey || feedApiKey(root).source === "environment"
          : current.jevConfigured;
      if (parsed.jevEnabled && !configured)
        throw new AgentStoreError({
          message: "Add a Jev API key before enabling relevance scoring.",
        });
      const { apiKey, ...settings } = parsed;
      const next = { ...settings, revision: current.revision + 1 };
      if (apiKey !== undefined) saveKey(root, apiKey);
      db.prepare(
        "INSERT INTO feed_settings(id,revision,value) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,value=excluded.value",
      ).run(next.revision, JSON.stringify(next));
      db.prepare(
        "UPDATE feed_refresh SET requested=?,nextAt=0,lastError=NULL WHERE id=1",
      ).run(Number(next.enabled));
      db.prepare(
        "UPDATE feed_source_state SET etag=NULL,lastModified=NULL",
      ).run();
      // Changed preferences invalidate an older editor's authority and queued work.
      if (
        !next.enabled ||
        current.agentId !== next.agentId ||
        current.emailEnabled !== next.emailEnabled
      ) {
        db.prepare(
          "UPDATE runs SET cancelRequested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,finishedAt=CASE WHEN status='queued' THEN ? ELSE finishedAt END WHERE id=(SELECT curationRunId FROM feed_refresh WHERE id=1) AND status IN ('queued','running')",
        ).run(Date.now());
      }
      return readFeedSettings(db, root);
    }),
  );

type ItemRow = Record<string, unknown>;
export function feedItemFromRow(row: ItemRow): FeedItem {
  return {
    ...JSON.parse(String(row.content)),
    id: String(row.id),
    createdAt: Number(row.createdAt),
    publishedAt: Number(row.publishedAt),
    score: Number(row.score),
    readAt: row.readAt === null ? null : Number(row.readAt),
    saved: !!row.saved,
    dismissed: !!row.dismissed,
  };
}
export function requireFeedItem(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT * FROM feed_items WHERE id=?").get(id);
  if (!row) throw new AgentStoreError({ message: "Feed item not found." });
  return row;
}
export const readFeed = (
  query: typeof FeedQuery.Type = {},
): Effect.Effect<FeedPage, AgentStoreError> =>
  withAgentStore((db, root) => {
    assertAvailable(db);
    const { filter = "all", before = Number.MAX_SAFE_INTEGER } =
      Schema.decodeUnknownSync(FeedQuery)(query);
    const settings = readFeedSettings(db, root);
    const sourceIds = settings.sources
      .filter((source) => source.enabled)
      .map((source) => source.id);
    const rows = db
      .prepare(`SELECT * FROM feed_items WHERE position<? AND dismissed=0 AND (visible=1 OR saved=1)
    AND (?<>'saved' OR saved=1) AND (?<>'unread' OR readAt IS NULL)
    AND (saved=1 OR sourceId IS NULL OR sourceId IN (SELECT value FROM json_each(?)))
    ORDER BY position DESC LIMIT 31`)
      .all(before, filter, filter, JSON.stringify(sourceIds));
    return {
      items: rows.slice(0, 30).map(feedItemFromRow),
      nextCursor: rows.length > 30 ? Number(rows[29]!.position) : null,
      settings,
      status: readFeedStatus(db, root),
    };
  });
export const actOnFeedItem = (input: typeof FeedAction.Type) =>
  withAgentStore((db) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      const { id, action } = Schema.decodeUnknownSync(FeedAction)(input);
      requireFeedItem(db, id);
      const updates: Record<typeof action, string> = {
        save: "saved=1",
        unsave: "saved=0",
        dismiss: "dismissed=1",
        restore: "dismissed=0",
        read: "readAt=COALESCE(readAt,?)",
        unread: "readAt=NULL",
        more: "feedback=1",
        less: "feedback=-1,dismissed=1",
      };
      db.prepare(`UPDATE feed_items SET ${updates[action]} WHERE id=?`).run(
        ...(action === "read" ? [Date.now(), id] : [id]),
      );
      if (action === "more" || action === "less") {
        db.prepare(
          "UPDATE feed_source_state SET etag=NULL,lastModified=NULL",
        ).run();
        db.prepare("UPDATE feed_refresh SET requested=1 WHERE id=1").run();
      }
      return feedItemFromRow(requireFeedItem(db, id));
    }),
  );
export const requestFeedRefresh = () =>
  withAgentStore((db, root) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      if (!readFeedSettings(db, root).enabled)
        throw new AgentStoreError({
          message: "Turn on the feed in Sources & preferences first.",
        });
      db.prepare("UPDATE feed_refresh SET requested=1 WHERE id=1").run();
      return readFeedStatus(db, root);
    }),
  );

export function canonicalFeedUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("utm_") || ["fbclid", "gclid"].includes(key))
      url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export function putFeedItem(
  db: DatabaseSync,
  item: FeedItem,
  dedupeKey: string,
  options: {
    sourceId?: string | null;
    visible?: boolean;
    fingerprint?: string;
  } = {},
) {
  const fingerprint =
    options.fingerprint ?? feedHash([item.title, item.summary, item.body]);
  const existing = db
    .prepare("SELECT * FROM feed_items WHERE dedupeKey=?")
    .get(dedupeKey);
  if (existing) {
    const previous = feedItemFromRow(existing);
    // A later source poll must not replace the agent's curated story with an excerpt.
    if (previous.kind === "story" && item.kind === "article") return previous;
    const merged = {
      ...item,
      id: previous.id,
      createdAt: previous.createdAt,
      readAt: previous.readAt,
      saved: previous.saved,
      dismissed: previous.dismissed,
    };
    db.prepare(
      "UPDATE feed_items SET content=?,fingerprint=?,score=?,visible=?,authorAgentId=?,sourceId=?,publishedAt=? WHERE id=?",
    ).run(
      JSON.stringify(merged),
      fingerprint,
      item.score ?? 0,
      Number(options.visible ?? true),
      item.authorAgentId,
      options.sourceId === undefined
        ? (existing.sourceId ?? null)
        : options.sourceId,
      item.publishedAt,
      previous.id,
    );
    return merged;
  }
  db.prepare(
    "INSERT INTO feed_items(id,dedupeKey,fingerprint,content,sourceId,authorAgentId,createdAt,publishedAt,score,visible) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(
    item.id,
    dedupeKey,
    fingerprint,
    JSON.stringify(item),
    options.sourceId ?? null,
    item.authorAgentId,
    item.createdAt,
    item.publishedAt,
    item.score ?? 0,
    Number(options.visible ?? true),
  );
  return item;
}

export const feedEditorContext = (agentId: string) =>
  withAgentStore((db, root) => {
    requireAgent(db, agentId);
    const settings = readFeedSettings(db, root);
    const rows = db
      .prepare(
        "SELECT * FROM feed_items WHERE dismissed=0 AND (json_extract(content,'$.kind')<>'update' OR authorAgentId=?) ORDER BY position DESC LIMIT 30",
      )
      .all(agentId);
    return {
      enabled: settings.enabled,
      interests: settings.interests,
      priorities: settings.priorities,
      emailEnabled: settings.emailEnabled && settings.agentId === agentId,
      selectedEditor: settings.agentId === agentId,
      sources: settings.sources.filter((source) => source.enabled),
      items: rows.map(feedItemFromRow),
      feedback: db
        .prepare(
          "SELECT content,feedback FROM feed_items WHERE feedback<>0 AND (json_extract(content,'$.kind')<>'update' OR authorAgentId=?) ORDER BY position DESC LIMIT 12",
        )
        .all(agentId)
        .map((row) => ({
          title: JSON.parse(String(row.content)).title,
          topics: JSON.parse(String(row.content)).topics,
          feedback: Number(row.feedback) > 0 ? "more" : "less",
        })),
    };
  });

export const publishFeedItem = (
  agentId: string,
  runId: string | undefined,
  input: FeedPublication,
) =>
  withAgentStore((db, root) =>
    writeTransaction(db, () => {
      assertAvailable(db);
      requireAgent(db, agentId);
      const data = Schema.decodeUnknownSync(FeedPublication)(input);
      const settings = readFeedSettings(db, root);
      if (!settings.enabled)
        throw new AgentStoreError({ message: "The shared feed is disabled." });
      const run = runId
        ? db
            .prepare(
              "SELECT * FROM runs WHERE id=? AND agentId=? AND status='running' AND cancelRequested=0",
            )
            .get(runId, agentId)
        : null;
      if (!run)
        throw new AgentStoreError({
          message: "Publishing requires an active agent run.",
        });
      if (
        data.kind === "update" &&
        (!settings.emailEnabled || settings.agentId !== agentId)
      )
        throw new AgentStoreError({
          message: "Personal updates are not enabled for this feed agent.",
        });
      if (data.kind === "story" && data.citations.length === 0)
        throw new AgentStoreError({
          message: "Stories need at least one original source citation.",
        });
      const fingerprint = feedHash(data);
      const prior = db
        .prepare("SELECT * FROM feed_publications WHERE requestId=?")
        .get(data.requestId);
      if (prior) {
        if (prior.agentId !== agentId || prior.fingerprint !== fingerprint)
          throw new AgentStoreError({
            message: "This feed publication request ID has already been used.",
          });
        return feedItemFromRow(requireFeedItem(db, String(prior.itemId)));
      }
      const curation = db
        .prepare("SELECT curationRunId FROM feed_refresh WHERE id=1")
        .get();
      if (curation?.curationRunId === runId) {
        const snapshot = JSON.parse(String(run.automationSnapshot));
        if (
          snapshot.revision !== settings.revision ||
          settings.agentId !== agentId
        )
          throw new AgentStoreError({
            message:
              "Feed preferences changed during this run. Wait for the next refresh.",
          });
      }
      let dedupeKey = `agent:${agentId}:${data.key}`;
      let sourceId: string | null = null;
      let candidate: FeedItem | undefined;
      let candidateFingerprint: string | undefined;
      if (data.candidateId) {
        const row = requireFeedItem(db, data.candidateId);
        candidate = feedItemFromRow(row);
        candidateFingerprint = String(row.fingerprint);
        if (!row.sourceId || data.kind !== "story")
          throw new AgentStoreError({
            message: "Only a publication article can be expanded into a story.",
          });
        if (
          !settings.sources.some(
            (source) => source.id === row.sourceId && source.enabled,
          )
        )
          throw new AgentStoreError({
            message: "That publication source is no longer enabled.",
          });
        if (
          !data.citations.some(
            (citation) =>
              canonicalFeedUrl(citation.url) ===
              canonicalFeedUrl(candidate!.url!),
          )
        )
          throw new AgentStoreError({
            message: "Include the original article in the story citations.",
          });
        dedupeKey = String(row.dedupeKey);
        sourceId = String(row.sourceId);
      }
      const now = Date.now();
      const item: FeedItem = {
        id: candidate?.id ?? randomUUID(),
        kind: data.kind,
        title: data.title,
        summary: data.summary,
        body: data.body,
        url: data.url ?? candidate?.url ?? null,
        imageUrl: data.imageUrl ?? candidate?.imageUrl ?? null,
        sourceName: data.sourceName,
        sourceUrl: data.sourceUrl ?? candidate?.sourceUrl ?? null,
        authorAgentId: agentId,
        publishedAt: candidate?.publishedAt ?? now,
        createdAt: candidate?.createdAt ?? now,
        readAt: null,
        saved: false,
        dismissed: false,
        topics: data.topics,
        why: data.why,
        importance: data.importance,
        score: candidate?.score ?? (data.importance === "important" ? 1 : 0.7),
        scoring: "agent",
        citations: data.citations,
      };
      const result = putFeedItem(db, item, dedupeKey, {
        sourceId,
        fingerprint: candidateFingerprint,
      });
      db.prepare(
        "INSERT INTO feed_publications(requestId,agentId,itemId,fingerprint) VALUES(?,?,?,?)",
      ).run(data.requestId, agentId, result.id, fingerprint);
      return result;
    }),
  );
