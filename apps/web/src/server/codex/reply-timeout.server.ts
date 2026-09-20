import { Clock, Effect } from "effect";
import { CodexError } from "./app-server.server";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export type ReplyActivity = {
  progress: () => void;
  pauseForApproval: () => () => void;
};

// Provider events must belong to this turn. Local queue checks and events from
// another conversation do not prove that the active reply is making progress.
export function isReplyProgress(
  method: string,
  params: unknown,
  threadId: string,
  turnId: string | undefined,
) {
  if (!turnId || !params || typeof params !== "object") return false;
  const event = params as {
    threadId?: unknown;
    turnId?: unknown;
    turn?: { id?: unknown };
  };
  return (
    event.threadId === threadId &&
    ((method.startsWith("item/") && event.turnId === turnId) ||
      ((method === "turn/started" || method === "turn/completed") &&
        event.turn?.id === turnId))
  );
}

export function withReplyTimeout<A, E, R>(
  reply: (activity: ReplyActivity) => Effect.Effect<A, E, R>,
  reflecting: boolean,
) {
  if (reflecting)
    return reply({ progress: () => {}, pauseForApproval: () => () => {} }).pipe(
      Effect.timeoutFail({
        duration: "2 minutes",
        onTimeout: () =>
          new CodexError({ message: "The reply timed out. Please try again." }),
      }),
    );

  return Effect.gen(function* () {
    const clock = yield* Clock.clockWith(Effect.succeed);
    let lastProgress = clock.unsafeCurrentTimeMillis();
    let approvals = 0;
    const activity: ReplyActivity = {
      progress: () => {
        lastProgress = clock.unsafeCurrentTimeMillis();
      },
      pauseForApproval: () => {
        approvals++;
        let resumed = false;
        return () => {
          if (resumed) return;
          resumed = true;
          approvals--;
          activity.progress();
        };
      },
    };
    const watch = Effect.gen(function* () {
      while (true) {
        const remaining = approvals
          ? IDLE_TIMEOUT_MS
          : IDLE_TIMEOUT_MS - (clock.unsafeCurrentTimeMillis() - lastProgress);
        if (remaining <= 0)
          return yield* new CodexError({
            message:
              "The agent stopped responding for 10 minutes. Its partial output is saved; check it before retrying.",
          });
        yield* Effect.sleep(remaining);
      }
    });
    // Interrupting either side still runs the reply's existing turn, tool, and
    // approval finalizers. Waiting for a person never grants an approval.
    return yield* Effect.raceFirst(reply(activity), watch);
  });
}
