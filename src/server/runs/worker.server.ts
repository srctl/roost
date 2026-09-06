import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Effect } from "effect";
import type { Message, ChatEvent } from "../../features/chat/schema";
import { withAgentStore, AgentStoreError } from "../agents/store.server";
import { CodexError } from "../codex/app-server.server";
import {
  readConversation,
  sendConversation,
} from "../codex/conversation.server";
import { readTimeline, putMessage } from "./timeline.server";
import {
  schedulerTick,
  claimRun,
  persistRun,
  finishRun,
  type Run,
} from "./store.server";

export const ensureTimeline = (agentId: string) =>
  Effect.gen(function* () {
    const exists = yield* withAgentStore(
      (db) =>
        !!db
          .prepare("SELECT agentId FROM timeline_imports WHERE agentId=?")
          .get(agentId),
    );
    if (exists) return;
    const history = yield* readConversation(agentId);
    yield* withAgentStore((db) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (
          !db
            .prepare("SELECT agentId FROM timeline_imports WHERE agentId=?")
            .get(agentId)
        ) {
          const pending = db
            .prepare(
              "SELECT message FROM timeline WHERE agentId=? ORDER BY position",
            )
            .all(agentId);
          db.prepare("DELETE FROM timeline WHERE agentId=?").run(agentId);
          for (const message of history.messages)
            putMessage(db, agentId, message);
          for (const row of pending)
            putMessage(db, agentId, JSON.parse(String(row.message)));
          db.prepare("INSERT INTO timeline_imports (agentId) VALUES (?)").run(
            agentId,
          );
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
  });

function mergeEvent(messages: Message[], event: ChatEvent): Message[] {
  if (event.type === "history") return [...event.messages];
  if (
    event.type !== "message" &&
    event.type !== "delta" &&
    event.type !== "activityDelta"
  )
    return messages;
  const id = event.type === "message" ? event.message.id : event.id;
  const previous = messages.find((m) => m.id === id);
  const next: Message =
    event.type === "message"
      ? event.message
      : {
          ...previous,
          id,
          role: event.type === "delta" ? "assistant" : "activity",
          text: (previous?.text ?? "") + event.text,
          ...(event.type === "activityDelta"
            ? { title: previous?.title ?? event.title, status: "inProgress" }
            : {}),
        };
  return previous
    ? messages.map((m) => (m.id === id ? next : m))
    : [...messages, next];
}
async function execute(run: Run, signal: AbortSignal) {
  let messages: Message[] = [];
  let status = "completed";
  let error: string | undefined;
  try {
    await Effect.runPromise(ensureTimeline(run.agentId), { signal });
    const timeline = await Effect.runPromise(readTimeline(run.agentId));
    const oldIds = new Set(timeline.map((m) => m.id));
    const taskNotice = timeline.find(
      (m) => m.id === run.id && m.role === "notice",
    );
    oldIds.delete(run.id);
    const emit = (event: ChatEvent) => {
      messages = mergeEvent(messages, event)
        .filter((message) => !oldIds.has(message.id))
        .map((message) =>
          taskNotice && message.id === run.id ? taskNotice : message,
        );
      if (event.type === "error") {
        status = "failed";
        error = event.message;
      }
      if (event.type === "done" && event.status !== "completed")
        status = event.status;
      Effect.runSync(persistRun(run, messages));
    };
    await Effect.runPromise(
      sendConversation(
        { agentId: run.agentId, messageId: run.id, text: run.prompt },
        emit,
        run.automationSnapshot ? JSON.parse(run.automationSnapshot) : undefined,
        run.kind,
      ).pipe(
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            status = "failed";
            error =
              cause instanceof CodexError || cause instanceof AgentStoreError
                ? cause.message
                : "The run could not finish. Check Codex and try again.";
          }),
        ),
      ),
      { signal },
    );
  } catch (cause) {
    status = signal.aborted ? "cancelled" : "failed";
    error = signal.aborted
      ? "Stopped. This run will not retry automatically."
      : "The run could not finish. Check Codex and try again.";
    // Expected failures are already sanitized at their server boundaries.
    if (cause instanceof CodexError || cause instanceof AgentStoreError)
      error = cause.message;
  }
  messages = messages.map((m) =>
    m.status === "inProgress" ? { ...m, status: "interrupted" } : m,
  );
  await Effect.runPromise(finishRun(run, status, messages, error));
}

type Worker = {
  owner: string;
  timer: ReturnType<typeof setInterval>;
  ticking: boolean;
  stopped: boolean;
  controllers: Map<string, AbortController>;
  background: Set<string>;
  tick: () => Promise<void>;
  tasks: Set<Promise<void>>;
};
const globalState = globalThis as typeof globalThis & {
  roostWorkers?: Map<string, Worker>;
};
const workers = (globalState.roostWorkers ??= new Map<string, Worker>());
export function startWorker() {
  const root = resolve(process.env.ROOST_DATA_DIR ?? ".roost");
  let worker = workers.get(root);
  if (!worker) {
    worker = {
      owner: randomUUID(),
      timer: undefined!,
      ticking: false,
      stopped: false,
      controllers: new Map(),
      background: new Set(),
      tick: async () => {},
      tasks: new Set(),
    };
    workers.set(root, worker);
    worker.timer = setInterval(() => void worker!.tick(), 1000);
    worker.timer.unref();
  }
  const current = worker;
  current.tick = async () => {
    if (current.ticking || current.stopped) return;
    current.ticking = true;
    try {
      const owns = await Effect.runPromise(schedulerTick(current.owner));
      if (!owns) {
        for (const controller of current.controllers.values())
          controller.abort();
        return;
      }
      const stops = await Effect.runPromise(
        withAgentStore((db) =>
          db
            .prepare(
              "SELECT id FROM runs WHERE status='running' AND cancelRequested=1",
            )
            .all(),
        ),
      );
      for (const stop of stops)
        current.controllers.get(String(stop.id))?.abort();
      while (!current.stopped && current.controllers.size < 4) {
        // Keep one slot available for user conversations while specialists work.
        const run = await Effect.runPromise(
          claimRun(current.owner, current.background.size < 3),
        );
        if (!run) break;
        const controller = new AbortController();
        current.controllers.set(run.id, controller);
        if (run.kind !== "chat") current.background.add(run.id);
        const task = execute(run, controller.signal)
          .catch(() =>
            console.error(
              "Roost could not persist a run outcome; it will be marked interrupted on recovery.",
            ),
          )
          .finally(() => {
            current.controllers.delete(run.id);
            current.background.delete(run.id);
            current.tasks.delete(task);
          });
        current.tasks.add(task);
      }
    } catch {
      console.error(
        "Roost scheduler could not access its persistent state; it will retry.",
      );
    } finally {
      current.ticking = false;
    }
  };
  void current.tick();
  return async () => {
    current.stopped = true;
    clearInterval(current.timer);
    while (current.ticking)
      await new Promise((resolve) => setTimeout(resolve, 10));
    for (const controller of current.controllers.values()) controller.abort();
    await Promise.allSettled([...current.tasks]);
    await Effect.runPromise(
      withAgentStore((db) =>
        db.prepare("DELETE FROM worker_lease WHERE owner=?").run(current.owner),
      ),
    );
    workers.delete(root);
  };
}
