import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import type {
  FeedItem,
  FeedPublication,
  FeedSettingsWrite,
} from "../src/features/feed/schema";
import { deleteAgentRecords } from "../src/server/agents/delete.server";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import { migrateFeed } from "../src/server/feed/migration.server";
import {
  actOnFeedItem,
  canonicalFeedUrl,
  DEFAULT_FEED_SETTINGS,
  feedApiKey,
  feedEditorContext,
  getFeedSettings,
  publishFeedItem,
  putFeedItem,
  readFeed,
  requestFeedRefresh,
  saveFeedSettings,
} from "../src/server/feed/store.server";
import { handleFeedTool } from "../src/server/feed/tools.server";
import { insertRun } from "../src/server/runs/store.server";

const run = Effect.runPromise;
async function fixture(action: (directory: string) => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-feed-store-");
  const names = [
    "ROOST_DATA_DIR",
    "ROOST_JEV_API_KEY",
    "TYPESAFE_API_KEY",
  ] as const;
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  process.env.ROOST_DATA_DIR = directory;
  delete process.env.ROOST_JEV_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    await action(directory);
  } finally {
    for (const name of names)
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    rmSync(directory, { recursive: true, force: true });
  }
}
const agent = (name = "Feed editor") =>
  run(
    saveAgent({
      id: randomUUID(),
      name,
      instructions: "Help curate the feed",
      character: "moss",
      model: "fake",
    }),
  );
async function runningRun(agentId: string) {
  const id = randomUUID();
  await run(
    withAgentStore((db) => {
      insertRun(db, { id, agentId, prompt: "Curate stories" }, Date.now());
      db.prepare("UPDATE runs SET status='running' WHERE id=?").run(id);
    }),
  );
  return id;
}
const article = (suffix = "1"): FeedItem => ({
  id: randomUUID(),
  kind: "article",
  title: `Local story ${suffix}`,
  summary: "Useful neighborhood information",
  body: "An attributed excerpt.",
  url: `https://news.example.com/${suffix}`,
  imageUrl: null,
  sourceName: "Local News",
  sourceUrl: DEFAULT_FEED_SETTINGS.sources[0]!.url,
  authorAgentId: null,
  publishedAt: 1000,
  createdAt: 2000,
  readAt: null,
  saved: false,
  dismissed: false,
  topics: ["Seattle"],
  why: "From a source you follow",
  importance: "normal",
  score: 0.7,
  scoring: "basic",
  citations: [],
});
const publication = (
  overrides: Partial<FeedPublication> = {},
): FeedPublication => ({
  requestId: randomUUID(),
  key: "stable-story",
  kind: "story",
  title: "Why this neighborhood change matters",
  summary: "A useful summary",
  body: "Sourced analysis with practical context.",
  sourceName: "Roost",
  topics: ["Seattle"],
  why: "Matches your neighborhood interests",
  importance: "normal",
  citations: [
    { title: "Original reporting", url: "https://news.example.com/1" },
  ],
  ...overrides,
});
async function configure(overrides: Partial<FeedSettingsWrite> = {}) {
  return run(
    saveFeedSettings({
      ...(await run(getFeedSettings())),
      enabled: true,
      ...overrides,
    }),
  );
}

test("additive feed migration preserves existing agents and defaults to no background or provider work", async () =>
  fixture(async () => {
    const existing = await agent();
    const settings = await run(getFeedSettings());
    assert.equal(settings.revision, 0);
    assert.equal(settings.enabled, false);
    assert.equal(settings.emailEnabled, false);
    assert.equal(settings.jevEnabled, false);
    assert.equal(settings.scorePrivateUpdates, false);
    assert.equal(settings.jevConfigured, false);
    assert.deepEqual(
      settings.sources.map((source) => source.url),
      [
        "https://www.capitolhillseattle.com/feed/",
        "https://www.seattletimes.com/seattle-news/feed/",
      ],
    );
    await run(
      withAgentStore((db) => {
        const version = db.prepare("PRAGMA user_version").get();
        migrateFeed(db);
        migrateFeed(db);
        assert.deepEqual(db.prepare("PRAGMA user_version").get(), version);
        assert.equal(
          db.prepare("SELECT name FROM agents WHERE id=?").get(existing.id)
            ?.name,
          existing.name,
        );
        assert.equal(
          db.prepare("SELECT COUNT(*) AS count FROM feed_refresh").get()?.count,
          1,
        );
        assert.equal(
          db.prepare("SELECT requested FROM feed_refresh WHERE id=1").get()
            ?.requested,
          0,
        );
      }),
    );
    assert.deepEqual((await run(readFeed())).items, []);
    await assert.rejects(run(requestFeedRefresh()), /Turn on the feed/);
  }));

test("settings use CAS, validate source identity and editor dependencies, and invalidate source validators", async () =>
  fixture(async () => {
    await assert.rejects(configure({ emailEnabled: true }), /Choose an agent/);
    await assert.rejects(
      configure({ agentId: randomUUID() }),
      /Agent not found/,
    );
    await assert.rejects(configure({ jevEnabled: true }), /API key/);
    const initial = await run(getFeedSettings());
    await assert.rejects(
      configure({ sources: [initial.sources[0]!, initial.sources[0]!] }),
      /unique URL and ID/,
    );
    const first = await configure({ interests: " Seattle transit " });
    assert.equal(first.revision, 1);
    assert.equal(first.interests, "Seattle transit");
    await assert.rejects(
      run(saveFeedSettings({ ...initial, enabled: true })),
      /changed elsewhere/,
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "INSERT INTO feed_source_state(sourceId,url,etag,lastModified) VALUES(?,?,?,?)",
          )
          .run(
            first.sources[0]!.id,
            first.sources[0]!.url,
            '"cached"',
            "yesterday",
          ),
      ),
    );
    await configure({ priorities: "Commuting" });
    await run(
      withAgentStore((db) => {
        const source = db
          .prepare("SELECT etag,lastModified FROM feed_source_state")
          .get()!;
        assert.equal(source.etag, null);
        assert.equal(source.lastModified, null);
        assert.equal(
          db.prepare("SELECT requested FROM feed_refresh WHERE id=1").get()
            ?.requested,
          1,
        );
      }),
    );
  }));

test("saved provider keys are private, redacted from settings and SQLite, and environment overrides are explicit", async () =>
  fixture(async (directory) => {
    const value = "test-only-feed-key";
    const settings = await configure({ apiKey: value, jevEnabled: true });
    assert.equal(settings.jevConfigured, true);
    assert.equal(settings.jevKeySource, "saved");
    assert.equal(JSON.stringify(settings).includes(value), false);
    const secretPath = join(directory, "secrets", "feed-jev-key");
    assert.equal(readFileSync(secretPath, "utf8"), value);
    assert.equal(statSync(secretPath).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, "secrets")).mode & 0o777, 0o700);
    await run(
      withAgentStore((db) =>
        assert.equal(
          String(
            db.prepare("SELECT value FROM feed_settings").get()?.value,
          ).includes(value),
          false,
        ),
      ),
    );
    await assert.rejects(
      run(
        saveFeedSettings({
          ...settings,
          revision: 0,
          apiKey: "must-not-replace",
        }),
      ),
      /changed elsewhere/,
    );
    assert.equal(feedApiKey(directory).key, value);
    process.env.TYPESAFE_API_KEY = "test-typesafe-environment";
    assert.equal(feedApiKey(directory).key, "test-typesafe-environment");
    process.env.ROOST_JEV_API_KEY = "test-roost-environment";
    assert.equal(feedApiKey(directory).key, "test-roost-environment");
    assert.equal((await run(getFeedSettings())).jevKeySource, "environment");
    await configure({ apiKey: "" });
    assert.equal(existsSync(secretPath), false);
    assert.equal((await run(getFeedSettings())).jevConfigured, true);
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.ROOST_JEV_API_KEY;
    assert.equal((await run(getFeedSettings())).jevConfigured, false);
  }));

test("dedupe preserves saved, read, dismissal, identity, order and curated content across source changes", async () =>
  fixture(async () => {
    const settings = await configure();
    const original = article();
    const dedupe = `url:${original.url}`;
    await run(
      withAgentStore((db) =>
        putFeedItem(db, original, dedupe, {
          sourceId: settings.sources[0]!.id,
        }),
      ),
    );
    await run(actOnFeedItem({ id: original.id, action: "save" }));
    const read = await run(actOnFeedItem({ id: original.id, action: "read" }));
    await run(actOnFeedItem({ id: original.id, action: "less" }));
    const updated = await run(
      withAgentStore((db) =>
        putFeedItem(db, { ...article(), title: "Changed title" }, dedupe, {
          sourceId: settings.sources[0]!.id,
        }),
      ),
    );
    assert.equal(updated.id, original.id);
    assert.equal(updated.createdAt, original.createdAt);
    assert.equal(updated.saved, true);
    assert.equal(updated.dismissed, true);
    assert.equal(updated.readAt, read.readAt);
    assert.deepEqual((await run(readFeed({ filter: "saved" }))).items, []);
    await run(actOnFeedItem({ id: original.id, action: "restore" }));
    assert.equal(
      (await run(readFeed({ filter: "saved" }))).items[0]?.title,
      "Changed title",
    );
    assert.equal((await run(readFeed({ filter: "unread" }))).items.length, 0);
    const story = await run(
      withAgentStore((db) =>
        putFeedItem(
          db,
          {
            ...updated,
            kind: "story",
            title: "Curated story",
            body: "The expanded story",
          },
          dedupe,
        ),
      ),
    );
    const refreshed = await run(
      withAgentStore((db) => putFeedItem(db, article(), dedupe)),
    );
    assert.equal(refreshed.title, story.title);
    assert.equal(refreshed.kind, "story");
    await run(
      withAgentStore((db) =>
        assert.equal(
          db
            .prepare("SELECT feedback FROM feed_items WHERE id=?")
            .get(original.id)?.feedback,
          -1,
        ),
      ),
    );
    await configure({
      sources: settings.sources.map((source) => ({
        ...source,
        enabled: false,
      })),
    });
    assert.equal(
      (await run(readFeed({ filter: "saved" }))).items[0]?.id,
      original.id,
    );
  }));

test("feed pagination is stable and bounded, filters hidden sources, and keeps saved candidates accessible", async () =>
  fixture(async () => {
    const settings = await configure();
    const ids: string[] = [];
    await run(
      withAgentStore((db) => {
        for (let index = 0; index < 36; index++) {
          const item = article(String(index));
          ids.push(item.id);
          putFeedItem(db, item, `url:${item.url}`, {
            sourceId: settings.sources[0]!.id,
          });
        }
        const hidden = article("hidden");
        ids.push(hidden.id);
        putFeedItem(db, hidden, `url:${hidden.url}`, {
          sourceId: settings.sources[0]!.id,
          visible: false,
        });
      }),
    );
    const first = await run(readFeed());
    assert.equal(first.items.length, 30);
    assert.ok(first.nextCursor);
    const second = await run(readFeed({ before: first.nextCursor! }));
    assert.equal(second.items.length, 6);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
      36,
    );
    await run(actOnFeedItem({ id: ids[36]!, action: "save" }));
    assert.equal(
      (await run(readFeed({ filter: "saved" }))).items[0]?.id,
      ids[36],
    );
    await configure({ sources: [] });
    assert.deepEqual(
      (await run(readFeed())).items.map((item) => item.id),
      [ids[36]],
    );
    assert.equal(
      canonicalFeedUrl(
        "https://news.example.com/a?utm_campaign=x&b=2&a=1#section",
      ),
      "https://news.example.com/a?a=1&b=2",
    );
  }));

test("publication requires current active ownership and sources, and retry keys preserve state without cross-agent overwrite", async () =>
  fixture(async () => {
    const a = await agent(),
      b = await agent("Other");
    const runA = await runningRun(a.id),
      runB = await runningRun(b.id);
    const input = publication();
    await assert.rejects(run(publishFeedItem(a.id, runA, input)), /disabled/);
    await configure();
    await assert.rejects(
      run(publishFeedItem(a.id, undefined, input)),
      /active agent run/,
    );
    await assert.rejects(
      run(publishFeedItem(a.id, runB, input)),
      /active agent run/,
    );
    await assert.rejects(
      run(publishFeedItem(a.id, runA, publication({ citations: [] }))),
      /source citation/,
    );
    const first = await run(publishFeedItem(a.id, runA, input));
    assert.deepEqual(await run(publishFeedItem(a.id, runA, input)), first);
    await assert.rejects(
      run(
        publishFeedItem(a.id, runA, { ...input, title: "Conflicting retry" }),
      ),
      /already been used/,
    );
    await assert.rejects(
      run(publishFeedItem(b.id, runB, input)),
      /already been used/,
    );
    await run(actOnFeedItem({ id: first.id, action: "save" }));
    const replacement = await run(
      publishFeedItem(a.id, runA, publication({ title: "Updated story" })),
    );
    assert.equal(replacement.id, first.id);
    assert.equal(replacement.saved, true);
    const other = await run(publishFeedItem(b.id, runB, publication()));
    assert.notEqual(other.id, first.id);
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET cancelRequested=1 WHERE id=?").run(runA),
      ),
    );
    await assert.rejects(
      run(publishFeedItem(a.id, runA, publication())),
      /active agent run/,
    );
  }));

test("publication-date pagination handles delayed ingestion, date ties and inserts between pages without repeats", async () =>
  fixture(async () => {
    const initial = await run(getFeedSettings());
    const settings = await configure({
      sources: initial.sources.map((source, index) => ({
        ...source,
        enabled: index === 0,
      })),
    });
    const existing = Array.from({ length: 45 }, (_, index) => ({
      ...article(`chronology-${index}`),
      publishedAt: 1000 + (index % 7) * 100,
      position: index + 1,
    }));
    const descending = (
      a: { publishedAt: number; position: number },
      b: { publishedAt: number; position: number },
    ) => b.publishedAt - a.publishedAt || b.position - a.position;
    await run(
      withAgentStore((db) => {
        for (const item of existing)
          putFeedItem(db, item, `url:${item.url}`, {
            sourceId: settings.sources[0]!.id,
          });
      }),
    );
    const ordered = [...existing].sort(descending);
    const first = await run(readFeed());
    assert.deepEqual(
      first.items.map((item) => item.id),
      ordered.slice(0, 30).map((item) => item.id),
    );
    assert.equal(first.nextCursor, ordered[29]!.position);
    const cursor = ordered[29]!;
    // Newer and same-date later arrivals belong before the already-returned cursor.
    // An older arrival belongs on a subsequent page even though its row ID is newer.
    const additions = [
      { ...article("arrived-newer"), publishedAt: 10_000, position: 46 },
      {
        ...article("arrived-tied"),
        publishedAt: cursor.publishedAt,
        position: 47,
      },
      {
        ...article("arrived-older"),
        publishedAt: cursor.publishedAt - 25,
        position: 48,
      },
      {
        ...article("disabled-source"),
        publishedAt: cursor.publishedAt - 30,
        position: 49,
      },
      {
        ...article("saved-hidden"),
        publishedAt: cursor.publishedAt - 40,
        position: 50,
      },
    ];
    await run(
      withAgentStore((db) => {
        for (const [index, item] of additions.entries())
          putFeedItem(db, item, `url:${item.url}`, {
            sourceId: settings.sources[index === 3 ? 1 : 0]!.id,
            visible: index !== 4,
          });
      }),
    );
    await run(actOnFeedItem({ id: additions[4]!.id, action: "save" }));
    const second = await run(readFeed({ before: first.nextCursor! }));
    const remaining = [...ordered.slice(30), additions[2]!, additions[4]!].sort(
      descending,
    );
    assert.deepEqual(
      second.items.map((item) => item.id),
      remaining.map((item) => item.id),
    );
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
      first.items.length + second.items.length,
    );
    assert.equal((await run(readFeed())).items[0]?.id, additions[0]!.id);
    assert.deepEqual(
      (await run(readFeed({ filter: "saved" }))).items.map((item) => item.id),
      [additions[4]!.id],
    );
    const missingCursor = await run(
      readFeed({ before: Number.MAX_SAFE_INTEGER }),
    );
    assert.deepEqual(missingCursor.items, []);
    assert.equal(missingCursor.nextCursor, null);
  }));

test("candidate expansion preserves original attribution, item state and dedupe fingerprint", async () =>
  fixture(async () => {
    const a = await agent();
    const runA = await runningRun(a.id);
    const settings = await configure({ agentId: a.id });
    const original = {
      ...article(),
      imageUrl: "https://images.example.com/source-hero.jpg",
    };
    await run(
      withAgentStore((db) =>
        putFeedItem(db, original, `url:${original.url}`, {
          sourceId: settings.sources[0]!.id,
          fingerprint: "source-version",
        }),
      ),
    );
    await run(actOnFeedItem({ id: original.id, action: "save" }));
    const input = publication({ candidateId: original.id });
    await assert.rejects(
      run(
        publishFeedItem(a.id, runA, {
          ...input,
          citations: [
            { title: "Unrelated", url: "https://news.example.com/wrong" },
          ],
        }),
      ),
      /original article/,
    );
    const expanded = await run(publishFeedItem(a.id, runA, input));
    assert.equal(expanded.id, original.id);
    assert.equal(expanded.saved, true);
    assert.equal(expanded.kind, "story");
    assert.equal(expanded.url, original.url);
    assert.equal(expanded.publishedAt, original.publishedAt);
    assert.equal(expanded.imageUrl, original.imageUrl);
    const preserved = await run(
      publishFeedItem(
        a.id,
        runA,
        publication({ candidateId: original.id, imageUrl: null }),
      ),
    );
    assert.equal(preserved.imageUrl, original.imageUrl);
    const replacementImage =
      "https://images.example.com/verified-replacement.jpg";
    const replaced = await run(
      publishFeedItem(
        a.id,
        runA,
        publication({ candidateId: original.id, imageUrl: replacementImage }),
      ),
    );
    assert.equal(replaced.imageUrl, replacementImage);
    await assert.rejects(
      run(
        publishFeedItem(
          a.id,
          runA,
          publication({
            candidateId: original.id,
            imageUrl: "http://127.0.0.1/private",
          }),
        ),
      ),
      /public HTTP or HTTPS/,
    );
    const unchanged = await run(
      publishFeedItem(a.id, runA, publication({ candidateId: original.id })),
    );
    assert.equal(unchanged.imageUrl, replacementImage);
    await run(
      withAgentStore((db) =>
        assert.equal(
          db
            .prepare("SELECT fingerprint FROM feed_items WHERE id=?")
            .get(original.id)?.fingerprint,
          "source-version",
        ),
      ),
    );
    await configure({ sources: [] });
    await assert.rejects(
      run(
        publishFeedItem(a.id, runA, publication({ candidateId: original.id })),
      ),
      /no longer enabled/,
    );
  }));

test("editor runs lose authority when their settings snapshot changes and disabling cancels queued work", async () =>
  fixture(async () => {
    const a = await agent();
    const runA = await runningRun(a.id);
    const settings = await configure({ agentId: a.id });
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runs SET automationSnapshot=? WHERE id=?").run(
          JSON.stringify({ revision: settings.revision }),
          runA,
        );
        db.prepare("UPDATE feed_refresh SET curationRunId=? WHERE id=1").run(
          runA,
        );
      }),
    );
    await configure({ interests: "Updated interests" });
    await assert.rejects(
      run(publishFeedItem(a.id, runA, publication())),
      /preferences changed during this run/,
    );
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET status='queued' WHERE id=?").run(runA),
      ),
    );
    await configure({ enabled: false });
    await run(
      withAgentStore((db) => {
        const queued = db
          .prepare("SELECT status,cancelRequested FROM runs WHERE id=?")
          .get(runA)!;
        assert.equal(queued.status, "cancelled");
        assert.equal(queued.cancelRequested, 1);
      }),
    );
  }));

test("shared editor context exposes public candidates but keeps another agent's personal items and feedback private", async () =>
  fixture(async () => {
    const a = await agent(),
      b = await agent("Other");
    const settings = await configure({ agentId: a.id, emailEnabled: true });
    const publicItem = article("public");
    const privateItem = {
      ...article("private"),
      kind: "update" as const,
      authorAgentId: a.id,
      title: "Private appointment details",
      topics: ["Private topic"],
    };
    await run(
      withAgentStore((db) => {
        putFeedItem(db, publicItem, "public", {
          sourceId: settings.sources[0]!.id,
        });
        putFeedItem(db, privateItem, "private");
      }),
    );
    await run(actOnFeedItem({ id: privateItem.id, action: "more" }));
    const own = await run(feedEditorContext(a.id));
    assert.equal(own.emailEnabled, true);
    assert.equal(own.selectedEditor, true);
    assert.ok(own.items.some((item) => item.id === privateItem.id));
    const other = await run(feedEditorContext(b.id));
    assert.equal(other.emailEnabled, false);
    assert.equal(other.selectedEditor, false);
    assert.ok(other.items.some((item) => item.id === publicItem.id));
    assert.equal(
      JSON.stringify(other).includes("Private appointment details"),
      false,
    );
    assert.equal(JSON.stringify(other).includes("Private topic"), false);
  }));

test("any agent can publish personal updates without an email editor, with attribution and safe retries", async () =>
  fixture(async () => {
    const a = await agent("Guy"),
      b = await agent("Other");
    const runA = await runningRun(a.id),
      runB = await runningRun(b.id);
    const input = publication({
      kind: "update",
      key: "hockey-roundup",
      citations: [],
    });
    assert.equal(
      (await run(feedEditorContext(a.id))).personalUpdatesEnabled,
      false,
    );
    await assert.rejects(run(publishFeedItem(a.id, runA, input)), /disabled/);
    await configure();
    const context = await run(feedEditorContext(a.id));
    assert.equal(context.personalUpdatesEnabled, true);
    assert.equal(context.emailEnabled, false);
    assert.equal(context.selectedEditor, false);
    await assert.rejects(
      run(publishFeedItem(a.id, runB, input)),
      /active agent run/,
    );
    const first = await run(
      handleFeedTool(a.id, runA, "roost_publish_feed_item", input),
    );
    assert.equal("authorAgentId" in first && first.authorAgentId, a.id);
    assert.deepEqual(
      await run(handleFeedTool(a.id, runA, "roost_publish_feed_item", input)),
      first,
    );
    await run(
      publishFeedItem(
        b.id,
        runB,
        publication({ kind: "update", key: "hockey-roundup", citations: [] }),
      ),
    );
    assert.equal((await run(readFeed())).items.length, 2);
    assert.equal(
      (await run(feedEditorContext(b.id))).items.some(
        (item) => item.id === ("id" in first && first.id),
      ),
      false,
    );
  }));

test("personal publication stays local until the separate private-scoring opt-in, then uses mocked Jev without hiding important updates", async () =>
  fixture(async () => {
    const a = await agent(),
      b = await agent("Other");
    const runA = await runningRun(a.id),
      runB = await runningRun(b.id);
    await configure({
      agentId: a.id,
      emailEnabled: true,
      apiKey: "test-private-scoring-key",
      jevEnabled: true,
    });
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.state.recent_feed_titles, []);
      const answer = {
        type: "score",
        score: 0,
        confidence: 1,
        probabilities: { "0": 1, "1": 0, "2": 0, "3": 0 },
      };
      return Response.json({
        model: "jev-1.13.0",
        answers: {
          relevance: answer,
          importance: answer,
          actionability: answer,
          novelty: answer,
        },
        usage: { input_tokens: 600 },
      });
    };
    try {
      const local = await run(
        handleFeedTool(
          a.id,
          runA,
          "roost_publish_feed_item",
          publication({ kind: "update", importance: "important" }),
        ),
      );
      assert.equal(calls, 0);
      assert.equal("scoring" in local && local.scoring, "agent");
      const other = await run(
        handleFeedTool(
          b.id,
          runB,
          "roost_publish_feed_item",
          publication({ kind: "update" }),
        ),
      );
      assert.equal("scoring" in other && other.scoring, "agent");
      assert.equal(calls, 0);
      await configure({ scorePrivateUpdates: true });
      const scored = await run(
        handleFeedTool(
          a.id,
          runA,
          "roost_publish_feed_item",
          publication({
            kind: "update",
            key: "second-update",
            importance: "important",
          }),
        ),
      );
      assert.equal(calls, 1);
      assert.equal("scoring" in scored && scored.scoring, "jev");
      assert.equal("score" in scored && scored.score, 0.9);
      assert.equal((await run(readFeed())).items.length, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));

test("deleting the selected editor revokes its feed authority while preserving shared stories and another agent's records", async () =>
  fixture(async () => {
    const a = await agent(),
      b = await agent("Other");
    const runA = await runningRun(a.id),
      runB = await runningRun(b.id);
    const settings = await configure({ agentId: a.id, emailEnabled: true });
    const owned = await run(publishFeedItem(a.id, runA, publication()));
    const other = await run(publishFeedItem(b.id, runB, publication()));
    await run(
      withAgentStore((db) => {
        db.prepare("UPDATE runs SET status='completed' WHERE id IN (?,?)").run(
          runA,
          runB,
        );
        for (const [agentId, itemId] of [
          [a.id, owned.id],
          [b.id, other.id],
        ])
          db.prepare(
            "INSERT INTO feed_discussions(requestId,itemId,agentId,conversationId) VALUES(?,?,?,?)",
          ).run(randomUUID(), itemId!, agentId!, agentId!);
      }),
    );
    await run(deleteAgentRecords({ agentId: a.id, name: a.name }));
    const current = await run(getFeedSettings());
    assert.equal(current.agentId, null);
    assert.equal(current.emailEnabled, false);
    assert.ok(current.revision > settings.revision);
    assert.equal((await run(readFeed())).items.length, 2);
    await run(
      withAgentStore((db) => {
        for (const table of ["feed_publications", "feed_discussions"]) {
          assert.equal(
            db
              .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE agentId=?`)
              .get(a.id)?.count,
            0,
          );
          assert.equal(
            db
              .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE agentId=?`)
              .get(b.id)?.count,
            1,
          );
        }
        assert.throws(
          () =>
            db
              .prepare(
                "INSERT INTO feed_publications(requestId,agentId,itemId,fingerprint) VALUES(?,?,?,?)",
              )
              .run(randomUUID(), a.id, owned.id, "late"),
          /Agent was deleted/,
        );
        assert.throws(
          () =>
            db
              .prepare(
                "INSERT INTO feed_discussions(requestId,itemId,agentId,conversationId) VALUES(?,?,?,?)",
              )
              .run(randomUUID(), owned.id, a.id, a.id),
          /Agent was deleted/,
        );
      }),
    );
  }));

test("feedback on a disabled feed does not leave a permanently refreshing status", async () =>
  fixture(async () => {
    const item = article();
    await run(withAgentStore((db) => putFeedItem(db, item, "disabled-item")));
    for (const action of ["more", "less"] as const) {
      await run(actOnFeedItem({ id: item.id, action }));
      assert.equal((await run(readFeed())).status.refreshing, false);
    }
  }));

test("an updated duplicate follows its current source and publication date", async () =>
  fixture(async () => {
    const settings = await configure();
    const item = article();
    await run(
      withAgentStore((db) => {
        putFeedItem(db, item, "same-link", {
          sourceId: settings.sources[0]!.id,
        });
        putFeedItem(
          db,
          { ...item, sourceName: "Second source", publishedAt: 3000 },
          "same-link",
          { sourceId: settings.sources[1]!.id },
        );
      }),
    );
    await configure({ sources: [settings.sources[1]!] });
    const page = await run(readFeed());
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.sourceName, "Second source");
    assert.equal(page.items[0]?.publishedAt, 3000);
  }));
