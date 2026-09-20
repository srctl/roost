import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JEV_FEED_MODEL,
  scoreFeedCandidate,
} from "../src/server/feed/jev.server";
import type { FeedCandidate } from "../src/server/feed/sources.server";

const candidate: FeedCandidate = {
  externalId: "story-1",
  title: "Light rail service changes",
  summary: "The weekend route will change.",
  body: "Full article text stays local.",
  url: "https://news.example.com/story",
  imageUrl: null,
  sourceName: "Local News",
  sourceUrl: "https://news.example.com/feed",
  publishedAt: Date.parse("2026-09-20T10:00:00Z"),
  topics: ["Seattle", "Transit"],
};
const context = {
  interests: "Seattle transit",
  priorities: "Getting to work",
  recentTitles: ["Last week's routes"],
  allowExternalScoring: true,
};
const answer = (level: number, confidence = 1) => ({
  type: "score",
  score: level,
  confidence,
  probabilities: Object.fromEntries(
    [0, 1, 2, 3].map((value) => [String(value), value === level ? 1 : 0]),
  ),
});
const responseBody = () => ({
  model: JEV_FEED_MODEL,
  answers: {
    relevance: answer(3),
    importance: answer(2),
    actionability: answer(1),
    novelty: answer(3, 0.8),
  },
  usage: { input_tokens: 750, output_tokens: 40 },
});

test("an API key alone never sends content without explicit runtime consent", async () => {
  let requests = 0;
  for (const allowExternalScoring of [undefined, false]) {
    await assert.rejects(
      scoreFeedCandidate(
        candidate,
        { ...context, allowExternalScoring },
        "test-key",
        {
          fetch: async () => {
            requests++;
            return Response.json(responseBody());
          },
        },
      ),
      /Enable Jev/,
    );
  }
  assert.equal(requests, 0);
});

test("sends one bounded scoring request and normalizes independent dimensions", async () => {
  const result = await scoreFeedCandidate(candidate, context, "test-key", {
    fetch: async (input, init) => {
      assert.equal(String(input), "https://api.typesafe.ai/v1/systemone");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-key",
      );
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, JEV_FEED_MODEL);
      assert.deepEqual(Object.keys(request.questions), [
        "relevance",
        "importance",
        "actionability",
        "novelty",
      ]);
      assert.equal(request.state.candidate.excerpt, candidate.summary);
      assert.equal(
        JSON.stringify(request.state).includes(candidate.body),
        false,
      );
      assert.equal(
        JSON.stringify(request.state).includes(candidate.url),
        false,
      );
      return Response.json(responseBody());
    },
  });
  assert.deepEqual(result, {
    relevance: 1,
    importance: 2 / 3,
    actionability: 1 / 3,
    novelty: 1,
    confidence: 0.8,
    model: JEV_FEED_MODEL,
    inputTokens: 750,
  });
});

test("bounds profile, excerpts and history even when the caller supplies huge input", async () => {
  await scoreFeedCandidate(
    { ...candidate, summary: "a".repeat(40_000) },
    {
      ...context,
      interests: "i".repeat(10_000),
      priorities: "p".repeat(10_000),
      recentTitles: Array.from({ length: 100 }, () => "t".repeat(5_000)),
    },
    "test-key",
    {
      fetch: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.state.candidate.excerpt.length, 3_000);
        assert.equal(request.state.reader.interests.length, 4_000);
        assert.equal(request.state.reader.priorities.length, 4_000);
        assert.equal(request.state.recent_feed_titles.length, 30);
        assert.ok(
          request.state.recent_feed_titles.every(
            (title: string) => title.length === 300,
          ),
        );
        return Response.json(responseBody());
      },
    },
  );
});

test("rejects missing scores, out-of-range values and malformed probability distributions", async () => {
  const invalidBodies: unknown[] = [];
  for (const mutate of [
    (value: ReturnType<typeof responseBody>) => {
      delete (value.answers as Record<string, unknown>).novelty;
    },
    (value: ReturnType<typeof responseBody>) => {
      value.answers.relevance.score = 4;
    },
    (value: ReturnType<typeof responseBody>) => {
      value.answers.relevance.confidence = -0.1;
    },
    (value: ReturnType<typeof responseBody>) => {
      value.answers.relevance.probabilities["3"] = 0.5;
    },
    (value: ReturnType<typeof responseBody>) => {
      value.answers.relevance.probabilities["0"] = 1;
    },
    (value: ReturnType<typeof responseBody>) => {
      value.answers.relevance.score = 0;
    },
    (value: ReturnType<typeof responseBody>) => {
      value.answers.relevance.type = "choice";
    },
    (value: ReturnType<typeof responseBody>) => {
      value.usage.input_tokens = -1;
    },
    (value: ReturnType<typeof responseBody>) => {
      value.model = "untrusted response secret";
    },
  ]) {
    const value = responseBody();
    mutate(value);
    invalidBodies.push(value);
  }
  invalidBodies.push(null, [], { answers: { relevance: { score: "3" } } });
  for (const body of invalidBodies)
    await assert.rejects(
      scoreFeedCandidate(candidate, context, "test-key", {
        fetch: async () => Response.json(body),
      }),
      /invalid scoring response/,
    );
});

test("allows fractional probability-weighted scores with rounding", async () => {
  const body = responseBody();
  body.answers.relevance = {
    type: "score",
    score: 2.6,
    confidence: 0.7,
    probabilities: { "0": 0, "1": 0, "2": 0.4, "3": 0.6 },
  };
  const result = await scoreFeedCandidate(candidate, context, "test-key", {
    fetch: async () => Response.json(body),
  });
  assert.equal(result.relevance, 2.6 / 3);
  assert.equal(result.confidence, 0.7);
});

test("does not expose provider response bodies or raw transport exceptions", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      scoreFeedCandidate(candidate, context, "sensitive-test-key", {
        fetch: async () =>
          new Response("Echoed sensitive-test-key and private article", {
            status,
          }),
      }),
      (error: Error) =>
        !error.message.includes("sensitive-test-key") &&
        !error.message.includes("private article"),
    );
  }
  await assert.rejects(
    scoreFeedCandidate(candidate, context, "sensitive-test-key", {
      fetch: async () => {
        throw new Error("Authorization: Bearer sensitive-test-key");
      },
    }),
    (error: Error) => !error.message.includes("sensitive-test-key"),
  );
  await assert.rejects(
    scoreFeedCandidate(candidate, context, "test-key", {
      fetch: async () => new Response("invalid JSON private article"),
    }),
    /invalid scoring response/,
  );
});

test("bounds huge and stalled scoring responses", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(100_001));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    scoreFeedCandidate(candidate, context, "test-key", {
      fetch: async () => new Response(body),
    }),
    /invalid scoring response/,
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    scoreFeedCandidate(candidate, context, "test-key", {
      timeoutMs: 5,
      fetch: async () => new Promise(() => {}),
    }),
    /timed out/,
  );
});

test("missing and malformed keys fail before any request", async () => {
  let calls = 0;
  for (const key of ["", " ", "bad\r\nkey"])
    await assert.rejects(
      scoreFeedCandidate(candidate, context, key, {
        fetch: async () => {
          calls++;
          return Response.json(responseBody());
        },
      }),
      /valid Jev API key/,
    );
  assert.equal(calls, 0);
});
