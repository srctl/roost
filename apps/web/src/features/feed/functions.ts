import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { available } from "../../server/available";
import { openFeedDiscussion } from "../../server/feed/discussion.server";
import {
  actOnFeedItem,
  readFeed,
  requestFeedRefresh,
  saveFeedSettings,
} from "../../server/feed/store.server";
import {
  startFeedWorker,
  wakeFeedWorker,
} from "../../server/feed/worker.server";
import {
  FeedAction,
  FeedDiscussion,
  FeedQuery,
  FeedSettingsWrite,
} from "./schema";

const result = <A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );
export const getFeed = createServerFn({ method: "GET" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(FeedQuery))
  .handler(({ data }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    return result(readFeed(data));
  });
export const updateFeedSettings = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(FeedSettingsWrite))
  .handler(async ({ data }) => {
    const saved = await result(saveFeedSettings(data));
    if (saved.ok) {
      startFeedWorker();
      wakeFeedWorker();
    }
    return saved;
  });
export const changeFeedItem = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(FeedAction))
  .handler(({ data }) => result(actOnFeedItem(data)));
export const refreshFeed = createServerFn({ method: "POST" })
  .middleware([available])
  .handler(async () => {
    const requested = await result(requestFeedRefresh());
    if (requested.ok) {
      startFeedWorker();
      wakeFeedWorker();
    }
    return requested;
  });
export const discussFeedItem = createServerFn({ method: "POST" })
  .middleware([available])
  .validator(Schema.decodeUnknownSync(FeedDiscussion))
  .handler(({ data }) => result(openFeedDiscussion(data)));
