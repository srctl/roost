import { Effect, Schema } from "effect";
import {
  FeedAction,
  FeedDiscussion,
  FeedQuery,
  FeedSettingsWrite,
} from "../../features/feed/schema";
import { openFeedDiscussion } from "../feed/discussion.server";
import {
  actOnFeedItem,
  readFeed,
  requestFeedRefresh,
  saveFeedSettings,
} from "../feed/store.server";
import { startFeedWorker, wakeFeedWorker } from "../feed/worker.server";
import { MobileWorkspaceError } from "./workspaces.server";

async function run<A, E extends { message: string }>(
  effect: Effect.Effect<A, E>,
) {
  const result = await Effect.runPromise(
    effect.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error: error.message }),
      }),
    ),
  );
  if (!result.ok) throw new MobileWorkspaceError(result.error);
  return result.value;
}
// Authentication and origin rejection happen in createMobileHandler first.
export async function mobileFeedRequest(
  path: string,
  request: Request,
  body: (request: Request) => Promise<unknown>,
  prepare?: (agentId: string) => Promise<void>,
): Promise<{ value: unknown; status?: number } | null> {
  if (path !== "feed" && !path.startsWith("feed/")) return null;
  if (path === "feed" && request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const query = Schema.decodeUnknownSync(FeedQuery)({
      ...(params.has("filter") ? { filter: params.get("filter") } : {}),
      ...(params.has("before") ? { before: Number(params.get("before")) } : {}),
    });
    return { value: await run(readFeed(query)) };
  }
  if (request.method !== "POST")
    return { value: { error: "Method not allowed." }, status: 405 };
  if (path === "feed/refresh") {
    const value = await run(requestFeedRefresh());
    startFeedWorker();
    wakeFeedWorker();
    return { value, status: 202 };
  }
  if (path === "feed/settings") {
    const value = await run(
      saveFeedSettings(
        Schema.decodeUnknownSync(FeedSettingsWrite)(await body(request)),
      ),
    );
    startFeedWorker();
    wakeFeedWorker();
    return { value };
  }
  const match = /^feed\/items\/([^/]+)(\/discuss)?$/.exec(path);
  if (!match) return { value: { error: "Not found." }, status: 404 };
  const id = Schema.decodeUnknownSync(Schema.UUID)(match[1]);
  const input = await body(request);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new MobileWorkspaceError("Invalid request.");
  return {
    value: match[2]
      ? await run(
          openFeedDiscussion(
            Schema.decodeUnknownSync(FeedDiscussion)({ ...input, id }),
            prepare,
          ),
        )
      : await run(
          actOnFeedItem(Schema.decodeUnknownSync(FeedAction)({ ...input, id })),
        ),
  };
}
