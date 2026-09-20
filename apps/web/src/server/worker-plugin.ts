import { definePlugin } from "nitro";
import { closeAgentRuntimes } from "./codex/agent-runtime.server";
import { closeLogin } from "./codex/login.server";
import { startFeedWorker } from "./feed/worker.server";
import { startWorker } from "./runs/worker.server";

export default definePlugin((app) => {
  const stop = startWorker();
  const stopFeed = startFeedWorker();
  app.hooks.hook("close", async () => {
    await stopFeed();
    await stop();
    await closeLogin();
    await closeAgentRuntimes();
  });
});
