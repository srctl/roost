import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import type { FeedItem, FeedSettingsWrite } from "../src/features/feed/schema";
import { saveAgent, withAgentStore } from "../src/server/agents/store.server";
import type {
  FeedCandidateScore,
  FeedScoringContext,
} from "../src/server/feed/jev.server";
import type {
  FeedCandidate,
  fetchFeedSource,
} from "../src/server/feed/sources.server";
import {
  actOnFeedItem,
  getFeedSettings,
  getFeedStatus,
  putFeedItem,
  readFeed,
  requestFeedRefresh,
  saveFeedSettings,
} from "../src/server/feed/store.server";
import { refreshFeedOnce } from "../src/server/feed/worker.server";

const run = Effect.runPromise;
const now = Date.parse("2026-09-20T12:00:00Z");
async function fixture(action: () => Promise<void>) {
  const directory = mkdtempSync("/tmp/roost-feed-worker-");
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
    await action();
  } finally {
    for (const name of names)
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    rmSync(directory, { recursive: true, force: true });
  }
}
async function configure(overrides: Partial<FeedSettingsWrite> = {}) {
  return run(
    saveFeedSettings({
      ...(await run(getFeedSettings())),
      enabled: true,
      ...overrides,
    }),
  );
}
const candidate = (suffix = "1", time = now): FeedCandidate => ({
  externalId: `article-${suffix}`,
  title: `Seattle transit ${suffix}`,
  summary: "New neighborhood transit service",
  body: "Published excerpt about transit service",
  url: `https://news.example.com/${suffix}`,
  imageUrl: null,
  sourceName: "Local News",
  sourceUrl: "https://news.example.com/feed",
  publishedAt: time,
  topics: ["Seattle", "Transit"],
});
const fetched = (
  items: FeedCandidate[],
  etag = '"v1"',
): Awaited<ReturnType<typeof fetchFeedSource>> => ({
  items,
  etag,
  lastModified: "Sun, 20 Sep 2026 10:00:00 GMT",
  notModified: false,
});
const decision: FeedCandidateScore = {
  relevance: 0.8,
  importance: 0.4,
  actionability: 0.2,
  novelty: 1,
  confidence: 0.9,
  model: "jev-1.13.0",
  inputTokens: 800,
};
async function singleSource(overrides: Partial<FeedSettingsWrite> = {}) {
  const initial = await run(getFeedSettings());
  return configure({ sources: [initial.sources[0]!], ...overrides });
}
async function counts() {
  return run(
    withAgentStore((db) => ({
      items: Number(
        db.prepare("SELECT COUNT(*) AS count FROM feed_items").get()?.count,
      ),
      scores: Number(
        db.prepare("SELECT COUNT(*) AS count FROM feed_scores").get()?.count,
      ),
      sources: Number(
        db.prepare("SELECT COUNT(*) AS count FROM feed_source_state").get()
          ?.count,
      ),
    })),
  );
}

test("disabled, not-due, maintenance and active-lease states never collect or score", async () =>
  fixture(async () => {
    let calls = 0;
    const deps = {
      now: () => now,
      fetchSource: async () => {
        calls++;
        return fetched([]);
      },
    };
    assert.equal(await refreshFeedOnce(deps), false);
    await singleSource();
    await run(
      withAgentStore((db) =>
        db
          .prepare("UPDATE feed_refresh SET requested=0,nextAt=? WHERE id=1")
          .run(now + 60_000),
      ),
    );
    assert.equal(await refreshFeedOnce(deps), false);
    await run(requestFeedRefresh());
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE feed_refresh SET owner='other',leaseUntil=? WHERE id=1",
          )
          .run(now + 60_000),
      ),
    );
    assert.equal(await refreshFeedOnce(deps), false);
    await run(
      withAgentStore((db) => {
        db.prepare(
          "UPDATE feed_refresh SET leaseUntil=NULL,owner=NULL WHERE id=1",
        ).run();
        db.prepare("UPDATE runtime_control SET maintenance=1 WHERE id=1").run();
      }),
    );
    assert.equal(await refreshFeedOnce(deps), false);
    assert.equal(calls, 0);
  }));

test("refresh commits bounded attributed stories, dedupes tracking URLs, persists cache validators and survives partial source failures", async () =>
  fixture(async () => {
    const settings = await configure();
    let scoreCalls = 0;
    const a = candidate();
    const result = await refreshFeedOnce({
      now: () => now,
      scoreCandidate: async () => {
        scoreCalls++;
        return decision;
      },
      fetchSource: async (source) => {
        if (source.id === settings.sources[0]!.id)
          throw new Error("secret upstream stack");
        return fetched([
          a,
          {
            ...a,
            externalId: "different",
            url: `${a.url}?utm_source=other#section`,
          },
        ]);
      },
    });
    assert.equal(result, true);
    assert.equal(scoreCalls, 0);
    const page = await run(readFeed());
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.scoring, "basic");
    assert.equal(page.items[0]?.sourceName, a.sourceName);
    assert.deepEqual(page.items[0]?.citations, [
      { title: a.title, url: a.url },
    ]);
    assert.match(page.status.lastError ?? "", /Could not refresh/);
    assert.equal(page.status.lastError?.includes("secret"), false);
    assert.equal(page.status.lastRefreshedAt, now);
    await run(requestFeedRefresh());
    let validators = 0;
    await refreshFeedOnce({
      now: () => now + 1_000,
      fetchSource: async (source) => {
        if (source.id === settings.sources[1]!.id) {
          assert.equal(source.etag, '"v1"');
          validators++;
        }
        return { ...fetched([]), notModified: true };
      },
    });
    assert.equal(validators, 1);
    assert.equal((await run(readFeed())).items.length, 1);
    assert.equal((await run(getFeedStatus())).lastError, null);
  }));

test("Jev opt-in and persisted scoring cache avoid duplicate work without leaking private feed context", async () =>
  fixture(async () => {
    const settings = await singleSource({
      jevEnabled: true,
      apiKey: "test-only-worker-key",
    });
    const owner = await run(
      saveAgent({
        id: randomUUID(),
        name: "Private",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const privateItem: FeedItem = {
      ...candidate("private"),
      id: randomUUID(),
      kind: "update",
      title: "Private email subject",
      sourceName: "Email",
      authorAgentId: owner.id,
      createdAt: now,
      readAt: null,
      saved: false,
      dismissed: false,
      why: "Private",
      importance: "important",
      score: 1,
      scoring: "agent",
      citations: [],
    };
    await run(withAgentStore((db) => putFeedItem(db, privateItem, "private")));
    await run(actOnFeedItem({ id: privateItem.id, action: "more" }));
    let scoreCalls = 0;
    const dependencies = {
      now: () => now,
      fetchSource: async () => fetched([candidate()]),
      scoreCandidate: async (
        _item: FeedCandidate,
        context: FeedScoringContext,
      ) => {
        scoreCalls++;
        assert.equal(context.allowExternalScoring, true);
        assert.equal(
          JSON.stringify(context).includes("Private email subject"),
          false,
        );
        return decision;
      },
    };
    await refreshFeedOnce(dependencies);
    assert.equal(scoreCalls, 1);
    assert.equal((await counts()).scores, 1);
    // Simulates retry after a cached provider result survived but publication did not.
    await run(
      withAgentStore((db) =>
        db
          .prepare("DELETE FROM feed_items WHERE sourceId=?")
          .run(settings.sources[0]!.id),
      ),
    );
    await run(requestFeedRefresh());
    await refreshFeedOnce(dependencies);
    assert.equal(scoreCalls, 1);
    assert.equal((await counts()).items, 2);
    await run(requestFeedRefresh());
    await refreshFeedOnce(dependencies);
    assert.equal(scoreCalls, 1);
    assert.equal((await counts()).items, 2);
    assert.equal(
      (await run(readFeed())).items.find((item) => item.kind === "article")
        ?.scoring,
      "jev",
    );
  }));

test("scoring outages retain locally ranked stories and report a sanitized status", async () =>
  fixture(async () => {
    await singleSource({ jevEnabled: true, apiKey: "test-only-worker-key" });
    await refreshFeedOnce({
      now: () => now,
      fetchSource: async () => fetched([candidate()]),
      scoreCandidate: async () => {
        throw new Error("Bearer secret-provider-key");
      },
    });
    const page = await run(readFeed());
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.scoring, "basic");
    assert.match(page.status.lastError ?? "", /basic ranking/);
    assert.equal(page.status.lastError?.includes("secret-provider-key"), false);
  }));

test("low-confidence scores keep candidates while confident irrelevance is hidden, with per-source variety caps", async () =>
  fixture(async () => {
    const settings = await configure({
      jevEnabled: true,
      apiKey: "test-only-worker-key",
    });
    await refreshFeedOnce({
      now: () => now,
      fetchSource: async (source) =>
        fetched(
          Array.from({ length: 20 }, (_, index) =>
            candidate(`${source.id}-${index}`, now - index),
          ),
        ),
      scoreCandidate: async (item) => ({
        ...decision,
        relevance: item.title.endsWith("-0") ? 0 : 0.8,
        importance: 0,
        confidence: item.title.endsWith("-0") ? 0.4 : 0.9,
      }),
    });
    const page = await run(readFeed());
    assert.equal(page.items.length, 12);
    await run(
      withAgentStore((db) => {
        for (const source of settings.sources)
          assert.equal(
            db
              .prepare(
                "SELECT COUNT(*) AS count FROM feed_items WHERE visible=1 AND sourceId=?",
              )
              .get(source.id)?.count,
            6,
          );
        assert.equal(
          db.prepare("SELECT COUNT(*) AS count FROM feed_items").get()?.count,
          40,
        );
      }),
    );
    await singleSource({ jevEnabled: true });
    await refreshFeedOnce({
      now: () => now + 1_000,
      fetchSource: async () =>
        fetched([candidate("irrelevant"), candidate("uncertain")]),
      scoreCandidate: async (item) => ({
        ...decision,
        relevance: 0,
        importance: 0,
        confidence: item.title.endsWith("uncertain") ? 0.2 : 1,
      }),
    });
    const items = (await run(readFeed())).items;
    assert.equal(
      items.some((item) => item.title.endsWith("irrelevant")),
      false,
    );
    assert.equal(
      items.some((item) => item.title.endsWith("uncertain")),
      true,
    );
  }));

test("concurrent refreshes claim one lease and stale workers cannot publish or clear a successor", async () =>
  fixture(async () => {
    await singleSource();
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const first = refreshFeedOnce({
      now: () => now,
      fetchSource: async () => {
        calls++;
        started();
        await barrier;
        return fetched([candidate()]);
      },
    });
    await entered;
    assert.equal(
      await refreshFeedOnce({
        now: () => now,
        fetchSource: async () => {
          calls++;
          return fetched([]);
        },
      }),
      false,
    );
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE feed_refresh SET owner='successor',leaseUntil=? WHERE id=1",
          )
          .run(now + 360_000),
      ),
    );
    release();
    await first;
    assert.equal(calls, 1);
    assert.deepEqual(await counts(), { items: 0, scores: 0, sources: 0 });
    await run(
      withAgentStore((db) =>
        assert.equal(
          db.prepare("SELECT owner FROM feed_refresh WHERE id=1").get()?.owner,
          "successor",
        ),
      ),
    );
  }));

test("changing preferences during collection revokes old scoring and publication before any provider call", async () =>
  fixture(async () => {
    await singleSource({ jevEnabled: true, apiKey: "test-only-worker-key" });
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let calls = 0;
    const pending = refreshFeedOnce({
      now: () => now,
      fetchSource: async () => {
        started();
        await barrier;
        return fetched([candidate()]);
      },
      scoreCandidate: async () => {
        calls++;
        return decision;
      },
    });
    await entered;
    await configure({ jevEnabled: false, interests: "New interests" });
    release();
    await pending;
    assert.equal(calls, 0);
    assert.deepEqual(await counts(), { items: 0, scores: 0, sources: 0 });
    await run(
      withAgentStore((db) => {
        const state = db
          .prepare("SELECT owner,requested FROM feed_refresh WHERE id=1")
          .get()!;
        assert.equal(state.owner, null);
        assert.equal(state.requested, 1);
      }),
    );
  }));

test("all-source failures retain prior success time and old items while a successful retry clears the error", async () =>
  fixture(async () => {
    await singleSource();
    await refreshFeedOnce({
      now: () => now,
      fetchSource: async () => fetched([candidate()]),
    });
    await run(requestFeedRefresh());
    await refreshFeedOnce({
      now: () => now + 1_000,
      fetchSource: async () => {
        throw new Error("private failure details");
      },
    });
    const failed = await run(readFeed());
    assert.equal(failed.items.length, 1);
    assert.equal(failed.status.lastRefreshedAt, now);
    assert.match(failed.status.lastError ?? "", /Could not refresh/);
    await run(requestFeedRefresh());
    await refreshFeedOnce({
      now: () => now + 2_000,
      fetchSource: async () => ({ ...fetched([]), notModified: true }),
    });
    assert.equal((await run(getFeedStatus())).lastError, null);
    assert.equal((await run(getFeedStatus())).lastRefreshedAt, now + 2_000);
  }));

test("selected editor queues one curation run with current settings, bounded email instructions and no notification permission", async () =>
  fixture(async () => {
    const editor = await run(
      saveAgent({
        id: randomUUID(),
        name: "Editor",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    const settings = await singleSource({
      agentId: editor.id,
      emailEnabled: true,
    });
    const deps = {
      now: () => now,
      fetchSource: async () => fetched([candidate()]),
    };
    await refreshFeedOnce(deps);
    const first = await run(
      withAgentStore((db) => {
        const row = db
          .prepare(
            "SELECT * FROM runs WHERE id=(SELECT curationRunId FROM feed_refresh WHERE id=1)",
          )
          .get()!;
        assert.equal(row.status, "queued");
        assert.equal(row.agentId, editor.id);
        assert.equal(row.kind, "automation");
        const snapshot = JSON.parse(String(row.automationSnapshot));
        assert.equal(snapshot.revision, settings.revision);
        assert.match(String(row.prompt), /at most 25 recent messages/);
        assert.match(
          String(row.prompt),
          /Never send, delete, archive, mark read/,
        );
        assert.match(String(row.prompt), /Do not notify/);
        return String(row.id);
      }),
    );
    await run(requestFeedRefresh());
    await refreshFeedOnce(deps);
    await run(
      withAgentStore((db) =>
        assert.equal(
          db
            .prepare("SELECT COUNT(*) AS count FROM runs WHERE agentId=?")
            .get(editor.id)?.count,
          1,
        ),
      ),
    );
    await run(
      withAgentStore((db) =>
        db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(first),
      ),
    );
    await run(requestFeedRefresh());
    await refreshFeedOnce(deps);
    await run(
      withAgentStore((db) =>
        assert.equal(
          db
            .prepare("SELECT COUNT(*) AS count FROM runs WHERE agentId=?")
            .get(editor.id)?.count,
          2,
        ),
      ),
    );
  }));

test("feedback submitted during scoring preserves cache invalidation for the requested reranking pass", async () =>
  fixture(async () => {
    await singleSource({ jevEnabled: true, apiKey: "test-only-worker-key" });
    await refreshFeedOnce({
      now: () => now,
      fetchSource: async () => fetched([candidate()]),
      scoreCandidate: async () => decision,
    });
    const existing = (await run(readFeed())).items[0]!;
    await run(requestFeedRefresh());
    const updated = { ...candidate(), title: "Seattle transit updated" };
    let release!: () => void, started!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = refreshFeedOnce({
      now: () => now + 1_000,
      fetchSource: async () => fetched([updated], '"v2"'),
      scoreCandidate: async () => {
        started();
        await barrier;
        return decision;
      },
    });
    await entered;
    await run(actOnFeedItem({ id: existing.id, action: "more" }));
    release();
    await pending;
    await run(
      withAgentStore((db) => {
        const state = db
          .prepare("SELECT etag,lastModified FROM feed_source_state")
          .get()!;
        assert.equal(state.etag, null);
        assert.equal(state.lastModified, null);
        assert.equal(
          db.prepare("SELECT requested FROM feed_refresh WHERE id=1").get()
            ?.requested,
          1,
        );
      }),
    );
    let reranked = false;
    await refreshFeedOnce({
      now: () => now + 2_000,
      fetchSource: async (source) => {
        assert.equal(source.etag, undefined);
        assert.equal(source.lastModified, undefined);
        return fetched([updated], '"v2"');
      },
      scoreCandidate: async (_candidate, context) => {
        reranked = true;
        assert.match(
          context.interests,
          /Previously liked: Seattle transit updated/,
        );
        return decision;
      },
    });
    assert.equal(reranked, true);
  }));

test("email checks keep a rolling 24-hour lookback after disabled-email runs and reported access failures", async () =>
  fixture(async () => {
    const editor = await run(
      saveAgent({
        id: randomUUID(),
        name: "Email editor",
        instructions: "Help",
        character: "moss",
        model: "fake",
      }),
    );
    await singleSource({ agentId: editor.id, emailEnabled: false });
    await refreshFeedOnce({
      now: () => now,
      fetchSource: async () => fetched([candidate()]),
    });
    await run(
      withAgentStore((db) =>
        db
          .prepare(
            "UPDATE runs SET status='completed',messages=? WHERE id=(SELECT curationRunId FROM feed_refresh WHERE id=1)",
          )
          .run(
            JSON.stringify([{ role: "assistant", text: "ROOST_NO_UPDATE" }]),
          ),
      ),
    );
    await configure({ emailEnabled: true });
    for (const time of [now + 3_600_000, now + 7_200_000]) {
      await refreshFeedOnce({
        now: () => time,
        fetchSource: async () => fetched([]),
      });
      await run(
        withAgentStore((db) => {
          const latest = db
            .prepare(
              "SELECT id,prompt FROM runs WHERE id=(SELECT curationRunId FROM feed_refresh WHERE id=1)",
            )
            .get()!;
          const prompt = String(latest.prompt);
          assert.match(prompt, /(?:last|past|rolling) 24[- ]hours?\b/i);
          assert.match(prompt, /stable key/);
          assert.doesNotMatch(
            prompt,
            /since the last feed pass|Previous successful editor pass/,
          );
          // A normally completed run can still report that it could not inspect email.
          db.prepare(
            "UPDATE runs SET status='completed',messages=? WHERE id=?",
          ).run(
            JSON.stringify([
              {
                role: "assistant",
                text: "Email access is unavailable; the inbox was not checked.",
              },
            ]),
            String(latest.id),
          );
        }),
      );
      assert.match(
        (await run(getFeedStatus())).lastError ?? "",
        /could not finish/,
      );
      await run(requestFeedRefresh());
    }
  }));
