import { definePlugin } from "nitro";
import { startWorker } from "./runs/worker.server";
import { closeAgentRuntimes } from "./codex/agent-runtime.server";
export default definePlugin((app) => {
  const stop = startWorker();
  app.hooks.hook("close", async () => {
    await stop();
    await closeAgentRuntimes();
  });
});
