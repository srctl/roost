import { Effect } from "effect";
import type { FeedDiscussion } from "../../features/feed/schema";
import { AgentStoreError, withAgentStore } from "../agents/store.server";
import { requireAgent } from "../automations/store.server";
import { assertAvailable } from "../maintenance.server";
import { enqueueChat } from "../runs/store.server";
import { openReplyThread } from "../runs/threads.server";
import { putMessage } from "../runs/timeline.server";
import { ensureTimeline, startWorker } from "../runs/worker.server";
import { writeTransaction } from "../transaction.server";
import {
  feedItemFromRow,
  readFeedSettings,
  requireFeedItem,
} from "./store.server";

export const openFeedDiscussion = (
  input: typeof FeedDiscussion.Type,
  prepare = async (agentId: string) => {
    startWorker();
    await Effect.runPromise(ensureTimeline(agentId));
  },
) =>
  Effect.gen(function* () {
    const target = yield* withAgentStore((db, root) => {
      assertAvailable(db);
      const existing = db
        .prepare("SELECT * FROM feed_discussions WHERE requestId=?")
        .get(input.requestId);
      if (
        existing &&
        (existing.itemId !== input.id ||
          (input.agentId && existing.agentId !== input.agentId))
      )
        throw new AgentStoreError({
          message: "This discussion request ID has already been used.",
        });
      const item = feedItemFromRow(requireFeedItem(db, input.id));
      const settings = readFeedSettings(db, root);
      const agentId = existing
        ? String(existing.agentId)
        : (input.agentId ??
          settings.agentId ??
          (item.authorAgentId &&
          db.prepare("SELECT id FROM agents WHERE id=?").get(item.authorAgentId)
            ? item.authorAgentId
            : null) ??
          String(
            db.prepare("SELECT id FROM agents ORDER BY createdAt LIMIT 1").get()
              ?.id ?? "",
          ));
      if (!agentId)
        throw new AgentStoreError({
          message: "Create an agent to discuss this story.",
        });
      requireAgent(db, agentId);
      return {
        agentId,
        item,
        existing: existing
          ? { agentId, conversationId: String(existing.conversationId) }
          : null,
      };
    });
    yield* Effect.tryPromise({
      try: () => prepare(target.agentId),
      catch: () =>
        new AgentStoreError({
          message: "Could not prepare the discussion. Try again.",
        }),
    });
    if (target.existing) {
      const alreadyQueued = yield* withAgentStore(
        (db) =>
          !!db.prepare("SELECT id FROM runs WHERE id=?").get(input.requestId),
      );
      if (alreadyQueued) return target.existing;
    }
    const parentId = `feed:${input.id}`;
    yield* withAgentStore((db) => {
      if (
        !db
          .prepare("SELECT id FROM timeline WHERE id=?")
          .get(`${parentId}:${target.agentId}`)
      )
        putMessage(db, target.agentId, {
          id: `${parentId}:${target.agentId}`,
          role: "assistant",
          title: target.item.title,
          text: `From your shared Feed · ${target.item.sourceName}\n\n# ${target.item.title}\n\n${target.item.body || target.item.summary}\n\nSources:\n${target.item.citations.map((citation) => `- ${citation.title}: ${citation.url}`).join("\n")}`,
        });
    });
    const thread = target.existing
      ? { id: target.existing.conversationId }
      : yield* openReplyThread(target.agentId, `${parentId}:${target.agentId}`);
    const receipt = yield* withAgentStore((db) =>
      writeTransaction(db, () => {
        db.prepare(
          "INSERT OR IGNORE INTO feed_discussions(requestId,itemId,agentId,conversationId) VALUES(?,?,?,?)",
        ).run(input.requestId, input.id, target.agentId, thread.id);
        const row = db
          .prepare("SELECT * FROM feed_discussions WHERE requestId=?")
          .get(input.requestId)!;
        if (row.itemId !== input.id || row.agentId !== target.agentId)
          throw new AgentStoreError({
            message: "This discussion request ID has already been used.",
          });
        return {
          agentId: target.agentId,
          conversationId: String(row.conversationId),
        };
      }),
    );
    yield* enqueueChat({
      agentId: receipt.agentId,
      conversationId: receipt.conversationId,
      messageId: input.requestId,
      text: "Help me understand this story and why it matters to me.",
    });
    return receipt;
  });
